import express from 'express';
import mysql from "mysql";
import cors from 'cors';
import jwt from 'jsonwebtoken'
import bcrypt from 'bcrypt'
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';

const salt = 10;

const app = express();
app.use(express.json());
app.use(cors({
    origin: ["http://88.200.63.148:6869"],
    methods: ["POST", "GET"],
    credentials: true

}));
app.use(cookieParser())

dotenv.config();
const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME
});

const verifyUser = (req, res , next) => {
    const token = req.cookies.token;
    console.log("Token received:", token);

    if (!token) {
        return res.json({ Error: "You are not authenticated" });
    }

    jwt.verify(token, "jwt-secret-key", (err, decoded) => {
        if (err) {
            console.error("JWT verify error:", err);
            return res.json({ Error: "token not correct" });
        }

        req.name = decoded.name;
        next();
    });
};

app.get('/', verifyUser, (req,res)=> {
    return res.json({Status: "Success", name: req.name});
})

//register page
app.post('/register', (req, res)=> {
    const sql = 'INSERT INTO login (`name`, `email`, `password`) VALUES (?)';
    bcrypt.hash(req.body.password.toString(), salt, (err, hash)=> {
        if(err) return res.json({Error: "Error for hashing password"});
        const values = [
        req.body.name,
        req.body.email,
        //req.body.password
        hash
    ]
    db.query(sql, [values], (err, result) => {
    if (err) {
        console.error("MySQL Insert Error:", err);  
        return res.json({ Error: "Inserting data error in server" });
    }
    return res.json({ Status: "Success" });
    });

    })
    
}) 

//login page
app.post('/login', (req, res) => {
    const sql = 'SELECT * from login WHERE email= ?';
    db.query(sql, [req.body.email], (err, data)=> {
        if (err) return res.json({Error: "Error for finding login in servo"});
        if(data.length > 0){
            bcrypt.compare(req.body.password.toString(), data[0].password, (err,response)=>{
                if(err) return res.json({Error: "Password compare error"});
                if(response) {
                    //generate a token
                    const name = data[0].name;
                    const token =jwt.sign({name}, "jwt-secret-key", {expiresIn: '1d'});
                    res.cookie('token', token);
                    return res.json({Status: "Success"});
                }else{
                    return res.json({Error: "Password not matched "})
                }
            })
        }else{
            return res.json({Error: "No email exists"});
        }
    })


})

//adding new cards to garden
app.post('/add-card', verifyUser, (req, res) => {
  const userName = req.name;
  const cardId = req.body.cardId; // sent from frontend
  console.log("cardId being added:", cardId); 

  const getUserSql = 'SELECT id FROM login WHERE name = ?';
  db.query(getUserSql, [userName], (err, userResult) => {
    if (err || userResult.length === 0) {
      return res.json({ Error: 'User not found' });
    }

    const userId = userResult[0].id;

    // get existing cards 
    const getCardsSql = 'SELECT * FROM cards WHERE user_id = ?';
    db.query(getCardsSql, [userId], (err, cardRows) => {
      if (err) return res.json({ Error: 'Failed to retrieve cards' });

      if (cardRows.length === 0) {
        const insertSql = 'INSERT INTO cards (user_id, card1_id) VALUES (?, ?)';
        db.query(insertSql, [userId, cardId], (err, result) => {
          if (err) return res.json({ Error: 'Failed to insert new cards row' });
          return res.json({ Status: 'Success', Message: 'Card added' });
        });
      } else {
        const row = cardRows[0];
        const slots = ['card1_id', 'card2_id', 'card3_id', 'card4_id', 'card5_id'];
        let nextSlot = slots.find(slot => row[slot] == null);

        if (!nextSlot) {
          return res.json({ Error: 'Max 5 cards reached' });
        }

        const updateSql = `UPDATE cards SET ${nextSlot} = ? WHERE user_id = ?`;
        db.query(updateSql, [cardId, userId], (err, result) => {
          if (err) return res.json({ Error: 'Failed to update cards' });
          return res.json({ Status: 'Success', Message: 'Card added' });
        });
      }
    });
  });

  
});

//displaying new cards 
app.get('/get-cards', verifyUser, (req, res) => {
  const userName = req.name;

  const getUserSql = 'SELECT id FROM login WHERE name = ?';
  db.query(getUserSql, [userName], (err, userResult) => {
    if (err || userResult.length === 0) {
      return res.json({ Error: 'User not found' });
    }

    const userId = userResult[0].id;

    const getCardsSql = 'SELECT * FROM cards WHERE user_id = ?';
    db.query(getCardsSql, [userId], (err, cardRowResults) => {
      if (err) return res.json({ Error: 'Failed to retrieve cards' });

      if (cardRowResults.length === 0) {
        //no cards
        return res.json({ cards: [] });
      }

      const cardRow = cardRowResults[0];
      //non-null cards
      const cardIds = [];
      for (let i = 1; i <= 5; i++) {
        if (cardRow[`card${i}_id`] !== null) {
          cardIds.push(cardRow[`card${i}_id`]);
        }
      }

      if (cardIds.length === 0) {
        return res.json({ cards: [] });
      }

      const placeholders = cardIds.map(() => '?').join(', ');
      const getCardInfoSql = `SELECT * FROM card_info WHERE id IN (${placeholders})`;

      db.query(getCardInfoSql, cardIds, (err, cardInfoResults) => {
        if (err) return res.json({ Error: 'Failed to fetch card info' });
        return res.json({ cards: cardInfoResults });
      });
    });
  });
});

app.post('/create-card-info', verifyUser, (req, res) => {
  const { title, description, image_url } = req.body;
  const sql = 'INSERT INTO card_info (title, description, image_url) VALUES (?, ?, ?)';
   // console.log('Inserted card info ID:', result.insertId);
  db.query(sql, [title, description, image_url], (err, result) => {
    if (err) {
      console.error('Failed to insert into card_info:', err);
      return res.json({ Error: 'Database insert failed' });
    }
    return res.json({ Status: 'Success', cardId: result.insertId });
  });

});


//delete card 
app.post('/delete-card', verifyUser, (req, res) => {
  const cardId = req.body.cardId;
  const userName = req.name;

  const getUserSql = 'SELECT id FROM login WHERE name = ?';
  db.query(getUserSql, [userName], (err, result) => {
    if (err || result.length === 0) {
      return res.json({ Error: 'User not found' });
    }

    const userId = result[0].id;

    // remove cardid from cards table
    const updateSql = `
      UPDATE cards
      SET card1_id = IF(card1_id = ?, NULL, card1_id),
          card2_id = IF(card2_id = ?, NULL, card2_id),
          card3_id = IF(card3_id = ?, NULL, card3_id),
          card4_id = IF(card4_id = ?, NULL, card4_id),
          card5_id = IF(card5_id = ?, NULL, card5_id)
      WHERE user_id = ?
    `;

    db.query(updateSql, [cardId, cardId, cardId, cardId, cardId, userId], (err, result) => {
      if (err) {
        return res.json({ Error: 'Failed to update card slots' });
      }

      //delete from card_info 
      const deleteInfoSql = 'DELETE FROM card_info WHERE id = ?';
      db.query(deleteInfoSql, [cardId], (err2, result2) => {
        if (err2) {
          return res.json({ Error: 'Failed to delete from card_info' });
        }
        return res.json({ Status: 'Success', Message: 'Card deleted' });
      });
    });
  });
});


app.get('/logout', (req, res) => {
  res.clearCookie('token', {
    httpOnly: true,
    secure: false,
    sameSite: 'None'    
  });
  return res.json({ Status: "Success", Message: "Logged out" });
});



app.listen(6868, '0.0.0.0', () => {
    console.log("Backend running on port 6868");
});

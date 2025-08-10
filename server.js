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

db.connect((err) => {
  if (err) {
    console.error('DB connection failed:', err);
  } else {
    console.log('Connected to MySQL database');
  }
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


//alert helper
function getLatestStatsQuery(userId) {
  /* returns one row for card with its most recent temperature/humidity/moisture */

  return `
    SELECT gs.card_id,
           ci.title,
           gs.min_temp, gs.max_temp,
           gs.min_humidity, gs.max_humidity,
           gs.min_moisture, gs.max_moisture,
           cs.temperature, cs.humidity, cs.moisture
    FROM garden_settings gs
    JOIN card_info ci      ON ci.id  = gs.card_id
    JOIN (
        SELECT x.card_id, x.temperature, x.humidity, x.moisture
        FROM card_stats x
        JOIN (
            SELECT card_id, MAX(recorded_at) AS latest
            FROM card_stats
            GROUP BY card_id
        ) y ON y.card_id = x.card_id AND y.latest = x.recorded_at
    ) cs ON cs.card_id = gs.card_id
    WHERE gs.user_id = ${db.escape(userId)}
  `;
}

/*check if parameters were exceeded */
function buildAlerts(rows) {
  const alerts = [];
  rows.forEach(r => {
    const push = (metric, value, limit, dir) =>
      alerts.push({
        cardId: r.card_id,
        cardTitle: r.title,
        metric,
        value,
        limit,
        dir            
      });

    if (r.max_temp      != null && r.temperature >  r.max_temp)      push('temperature', r.temperature, r.max_temp, 'above');
    if (r.min_temp      != null && r.temperature <  r.min_temp)      push('temperature', r.temperature, r.min_temp, 'below');
    if (r.max_humidity  != null && r.humidity    >  r.max_humidity)  push('humidity',    r.humidity,    r.max_humidity, 'above');
    if (r.min_humidity  != null && r.humidity    <  r.min_humidity)  push('humidity',    r.humidity,    r.min_humidity, 'below');
    if (r.max_moisture  != null && r.moisture    >  r.max_moisture)  push('moisture',    r.moisture,    r.max_moisture, 'above');
    if (r.min_moisture  != null && r.moisture    <  r.min_moisture)  push('moisture',    r.moisture,    r.min_moisture, 'below');
  });
  return alerts;
}




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
        if (err) {
            console.error("Login DB query error:", err);
            return res.json({Error: "Error for finding login in server"});
        }
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


//getting stats for specific plants 
app.get('/get-card-stats/:cardId', verifyUser, (req, res) => {
  const cardId = req.params.cardId;

  const sql = `
    SELECT temperature, humidity, moisture 
    FROM card_stats 
    WHERE card_id = ? 
    ORDER BY recorded_at DESC 
    LIMIT 1
  `;
  db.query(sql, [cardId], (err, results) => {
    if (err) return res.json({ Error: 'Failed to fetch stats' });

    if (results.length === 0) {
      return res.json({ temperature: null, humidity: null, moisture: null });
    }

    return res.json(results[0]);
  });
});

//history page graphs / data
app.get('/history/:cardId', async (req, res) => {
  const { cardId } = req.params;
  const { range } = req.query;

  let dateFilter = '';
  if (range === 'today') {
    dateFilter = 'AND DATE(recorded_at) = CURDATE()';
  } else if (range === 'week') {
    dateFilter = 'AND recorded_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)';
  } else if (range === 'month') {
    dateFilter = 'AND recorded_at >= DATE_SUB(CURDATE(), INTERVAL 1 MONTH)';
  }

  const sql = `
    SELECT temperature, humidity, moisture, recorded_at 
    FROM card_stats 
    WHERE card_id = ? ${dateFilter}
    ORDER BY recorded_at ASC
  `;

  db.query(sql, [cardId], (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(result);
  });
});



// get settings info
app.get('/garden-settings/:cardId', verifyUser, (req, res) => {
  const { cardId } = req.params;
  const userName = req.name;


  db.query('SELECT id FROM login WHERE name = ?', [userName], (err, userRows) => {
    if (err || userRows.length === 0) return res.status(401).json({ Error: 'User not found' });
    const userId = userRows[0].id;


    const ownsCardSql = `
      SELECT 1 FROM cards
      WHERE user_id = ?
        AND (card1_id = ? OR card2_id = ? OR card3_id = ? OR card4_id = ? OR card5_id = ?)
      LIMIT 1
    `;
    db.query(ownsCardSql, [userId, cardId, cardId, cardId, cardId, cardId], (err2, ownRows) => {
      if (err2) return res.status(500).json({ Error: 'Failed to check card ownership' });
      if (ownRows.length === 0) return res.status(403).json({ Error: 'Card does not belong to user' });

      // fetch parms
      const sel = 'SELECT * FROM garden_settings WHERE user_id = ? AND card_id = ? LIMIT 1';
      db.query(sel, [userId, cardId], (err3, rows) => {
        if (err3) return res.status(500).json({ Error: 'Failed to fetch settings' });

        if (!rows || rows.length === 0) {
          // empty start card
          return res.json({
            isFirstTime: true,
            minTemp: '',
            maxTemp: '',
            minHumidity: '',
            maxHumidity: '',
            minMoisture: '',
            maxMoisture: '',
            acOn: false,
            humidifierOn: false,
            wateringOn: false
          });
        }

        const r = rows[0];
        return res.json({
          isFirstTime: false,
          minTemp: r.min_temp,
          maxTemp: r.max_temp,
          minHumidity: r.min_humidity,
          maxHumidity: r.max_humidity,
          minMoisture: r.min_moisture,
          maxMoisture: r.max_moisture,
          acOn: !!r.ac_on,
          humidifierOn: !!r.humidifier_on,
          wateringOn: !!r.watering_on,
          updatedAt: r.updated_at
        });
      });
    });
  });
});

//sav or insert parms
app.post('/garden-settings/:cardId', verifyUser, (req, res) => {
  const { cardId } = req.params;
  const {
    minTemp, maxTemp,
    minHumidity, maxHumidity,
    minMoisture, maxMoisture,
    acOn, humidifierOn, wateringOn
  } = req.body;
  const userName = req.name;

  db.query('SELECT id FROM login WHERE name = ?', [userName], (err, userRows) => {
    if (err || userRows.length === 0) return res.status(401).json({ Error: 'User not found' });
    const userId = userRows[0].id;

    // verification
    const ownsCardSql = `
      SELECT 1 FROM cards
      WHERE user_id = ?
        AND (card1_id = ? OR card2_id = ? OR card3_id = ? OR card4_id = ? OR card5_id = ?)
      LIMIT 1
    `;
    db.query(ownsCardSql, [userId, cardId, cardId, cardId, cardId, cardId], (err2, ownRows) => {
      if (err2) return res.status(500).json({ Error: 'Failed to check card ownership' });
      if (ownRows.length === 0) return res.status(403).json({ Error: 'Card does not belong to user' });

      const sql = `
        INSERT INTO garden_settings
          (user_id, card_id, min_temp, max_temp, min_humidity, max_humidity, min_moisture, max_moisture, ac_on, humidifier_on, watering_on, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
        ON DUPLICATE KEY UPDATE
          min_temp = VALUES(min_temp),
          max_temp = VALUES(max_temp),
          min_humidity = VALUES(min_humidity),
          max_humidity = VALUES(max_humidity),
          min_moisture = VALUES(min_moisture),
          max_moisture = VALUES(max_moisture),
          ac_on = VALUES(ac_on),
          humidifier_on = VALUES(humidifier_on),
          watering_on = VALUES(watering_on),
          updated_at = NOW()
      `;

      const toNullOrNum = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
      const params = [
        userId,
        cardId,
        toNullOrNum(minTemp),
        toNullOrNum(maxTemp),
        toNullOrNum(minHumidity),
        toNullOrNum(maxHumidity),
        toNullOrNum(minMoisture),
        toNullOrNum(maxMoisture),
        acOn ? 1 : 0,
        humidifierOn ? 1 : 0,
        wateringOn ? 1 : 0
      ];

      db.query(sql, params, (err4) => {
        if (err4) {
          console.error('Failed to save settings:', err4);
          return res.status(500).json({ Error: 'Failed to save settings' });
        }
        return res.json({ Status: 'Success', Message: 'Settings saved' });
      });
    });
  });
});

//getting live alerts
app.get('/alerts', verifyUser, (req, res) => {
  const name = req.name;
  db.query('SELECT id FROM login WHERE name = ?', [name], (errU, uRows) => {
    if (errU || uRows.length === 0) return res.status(401).json({ Error: 'User not found' });
    const userId = uRows[0].id;

    db.query(getLatestStatsQuery(userId), (errS, rows) => {
      if (errS) return res.status(500).json({ Error: 'Failed to compute alerts' });
      return res.json(buildAlerts(rows));
    });
  });
});


/*app.get('/logout', (req, res) => {
  res.clearCookie('token', {
    httpOnly: true,
    secure: false,
    sameSite: 'None'    
  });
  return res.json({ Status: "Success", Message: "Logged out" });
});*/


app.get('/logout', (req, res) => {
  res.clearCookie('token', {
    httpOnly: true,
    secure: false,
    sameSite: 'lax'    
  });
  return res.json({ Status: "Success", Message: "Logged out" });
});


app.listen(6868, '0.0.0.0', () => {
    console.log("Backend running on port 6868");
});

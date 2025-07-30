import express from 'express';
import mysql from "mysql";
import cors from 'cors';
import jwt from 'jsonwebtoken'
import bcrypt from 'bcrypt'
import cookieParser from 'cookie-parser';

const salt = 10;

const app = express();
app.use(express.json());
app.use(cors({
    origin: ["http://88.200.63.148:6869"],
    methods: ["POST", "GET"],
    credentials: true

}));
app.use(cookieParser())

const db =mysql.createConnection({
    host: "localhost",
   // port: 6869,
    user: "studenti",
    password: "password",
    database: 'SISIII2025_89231012p',
    
})

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
        console.error("MySQL Insert Error:", err);  // ADD THIS LINE
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
                    const name = data[0].name;//keep this key in .env file dont push to gihub reminder
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

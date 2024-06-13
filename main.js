require('dotenv').config({path: 'config.env'});
const express = require('express');
const mysql = require('mysql');
const cors = require('cors');
const axios = require('axios');
const qs = require('querystring');
const CryptoJS = require('crypto-js');

const app = express();
const port = process.env.PORT || 3000;
app.use(express.json());
let selectedDepot = "";
let userName = "";

const corsOptions = {
    origin: ['http://127.0.0.1:5500', 'http://localhost:5500'], // Cors options need to be altered to represent the location of the html file
};

app.use(cors(corsOptions));

const { Pool } = require('pg');

const pool = new Pool({
    user: process.env.DB_USER_POST,
    host: process.env.DB_HOST_POST,
    database: process.env.DB_DATABASE_LOGIN_POST,
    password: process.env.DB_PASS_POST,
    port: process.env.DB_PORT,
});

app.get('/data', async (req, res) => {
    const searchQuery = req.query.search;
    const depotSelection = req.query.depot;
    const searchType = req.query.searchType || 'desc';

    console.log("Database Table:", process.env.DB_NAME_POST);

    let baseQuery = `SELECT * FROM "${process.env.DB_NAME_POST}" WHERE "stklevel" > 0 AND "sold" = 0 AND "currdepot" != 'stok'`;

    let queryParams = [];

    if (searchQuery) {
        if (searchType === 'grpCode') {
            baseQuery += ` AND "grpcode" ILIKE $1`;
            queryParams.push(`%${searchQuery}%`);
        } else {
            baseQuery += ` AND "desc1" ILIKE $1`;
            queryParams.push(`%${searchQuery}%`);
        }
    }

    if (depotSelection && depotSelection !== "ALL") {
        baseQuery += ` AND "currdepot" = $${queryParams.length + 1}`;
        queryParams.push(depotSelection);
    }

    console.log("SQL Query:", baseQuery);
    console.log("Query Parameters:", queryParams);

    try {
        const { rows } = await pool.query(baseQuery, queryParams);
        if (rows.length === 0) {
            res.json({ message: 'No data available.', data: [] });
            return;
        }

        const groupedByGrpCode = rows.reduce((acc, curr) => {
            if (!acc[curr.grpcode]) acc[curr.grpcode] = [];
            acc[curr.grpcode].push(curr);
            return acc;
        }, {});

        res.json({ randomData: groupedByGrpCode });
    } catch (error) {
        console.error('Failed to execute query:', error);
        notifyAdminAboutQueryFailure();
        res.status(500).json({ message: 'Error retrieving data', error: error.message });
    }
});

async function notifyAdminAboutQueryFailure(error) {
    const accessToken = await getAccessToken();
    const emailBodyContent = `A database query failed, please check the accessibility of all tables.`;

    const message = {
        subject: 'Database Query Failure Notification',
        body: {
            contentType: "Text",
            content: emailBodyContent
        },
        toRecipients: [
            { emailAddress: { address: 'mitchell.price@idesystems.co.uk' } },
            { emailAddress: { address: 'david.weaver@idesystems.co.uk' } }
        ]
    };

    try {
        await axios.post('https://graph.microsoft.com/v1.0/users/mitchell.price@idesystems.co.uk/sendMail', { message, saveToSentItems: "true" }, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });
        console.log('Admin notified about the database query failure.');
    } catch (error) {
        console.error('Failed to send error notification email:', error.response ? error.response.data : error);
    }
}


async function getAccessToken() {
    const tenantId = process.env.TENANT_ID;
    const clientId = process.env.CLIENT_ID;
    const clientSecret = process.env.CLIENT_SECRET;
    const tokenEndpoint = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

    const requestBody = {
        client_id: clientId,
        scope: 'https://graph.microsoft.com/.default',
        client_secret: clientSecret,
        grant_type: 'client_credentials'
    };

    try {
        const response = await axios.post(tokenEndpoint, qs.stringify(requestBody), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });
        return response.data.access_token;
    } catch (error) {
        console.error('Failed to obtain access token:', error.response ? error.response.data : error);
        return null;
    }
}

app.post('/sendEmail', async (req, res) => {
    const { email, ccEmail, poNumber, notes, deliveryAddress, entries, collectionDepot, collectionTime } = req.body;
    const accessToken = await getAccessToken();

    let isCollection = collectionDepot !== ''; // Assuming `collectionDepot` holds the depot info if collection is selected
    let emailBodyContent = entries.map(entry => `${entry.desc}: Quantity ${entry.count}`).join('\n');
    emailBodyContent += `\n\nNotes: ${notes}\n`;

    if (isCollection) {
        emailBodyContent += `Collection Depot: ${collectionDepot}\nProjected Collection Date: ${collectionTime}\n`;
    } else {
        emailBodyContent += `Delivery Address: ${deliveryAddress || 'TBC'}`;
    }

    const message = {
        subject: `PO Number: ${poNumber} - IDE PO Query`,
        body: {
            contentType: "Text",
            content: emailBodyContent
        },
        toRecipients: [
            { emailAddress: { address: email } }
        ],
        ccRecipients: [
            { emailAddress: { address: ccEmail } }
        ]
    };

    try {
        const response = await axios.post('https://graph.microsoft.com/v1.0/users/mitchell.price@idesystems.co.uk/sendMail', {
            message,
            saveToSentItems: "true"
        }, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        const insertQuery = `INSERT INTO ${process.env.WRITE_TO_TABLE_POST} (company, name, email, addr, del_addr, details, po, notes, depot, date) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`;
        
        const company = "IDE"; // Default value
        const name = userName || "default_user"; // Assuming userName is set during login
        const addr = ""; // Adjust this to capture the actual address if needed
        const entriesJSON = JSON.stringify(entries); // Convert entries array to JSON string
        const depot = isCollection ? collectionDepot : null;
        const date = new Date(); // Current date and time

        // Check all variables to ensure none are null or undefined
        console.log('Inserting:', { company, name, email, addr, deliveryAddress, entriesJSON, poNumber, notes, depot, date });

        // Using parameterized query to prevent SQL injection
        await pool.query(insertQuery, [company, name, email, addr, deliveryAddress, entriesJSON, poNumber, notes, depot, date]);

        res.send('Email sent and order logged successfully');
    } catch (error) {
        console.error('Failed to send email or log order:', error);
        res.status(500).send('Error sending email or logging order');
    }
});


async function verifyUser(username, password) {
    const hashedPassword = CryptoJS.SHA256(password).toString(CryptoJS.enc.Hex);
    const query = `SELECT * FROM ${process.env.CRED_TABLE_POST} WHERE username = $1 AND password = $2`;
    try {
        const results = await pool.query(query, [username, hashedPassword]);
        if (results.rows.length > 0) {
            userName = username; // Store the username on successful login
            return true;
        }
        return false;
    } catch (error) {
        console.error('SQL Error:', error);
        throw error; // Rethrow to handle outside
    }
}

app.post('/checkPassword', async (req, res) => {
    try {
        const success = await verifyUser(req.body.username, req.body.password);
        if (success) {
            res.json({ success: true, message: 'Login successful' });
        } else {
            res.status(401).json({ success: false, message: 'Username or password incorrect' });
        }
    } catch (error) {
        res.status(500).send('Internal Server Error');
    }
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const hashedPassword = CryptoJS.SHA256(password).toString(CryptoJS.enc.Hex);
    try {
        const query = `SELECT * FROM ${process.env.CRED_TABLE_POST} WHERE username = $1 AND password = $2`;
        const results = await pool.query(query, [username, hashedPassword]);

        if (results.rows.length > 0) {
            userName = username; // Store the username on successful login
            res.json({ success: true, message: 'Login successful' });
        } else {
            res.status(401).json({ success: false, message: 'Username or password incorrect' });
        }
    } catch (err) {
        console.error('SQL Error:', err);
        res.status(500).send('Internal Server Error');
    }
});

app.use(express.static('Stock Picker Node.js Project')); // #### Needs to be populated with new hosting dir name ####
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`); // #### change port in env file and edit localhost to new host domain ####
});

const pool = require('../db/Connect_Db');
const nodemailer = require('nodemailer');

const supportController = {
    getContactInfo: async (req, res) => {
        let conn;
        try {
            conn = await pool.getConnection();
            const [rows] = await conn.query('SELECT address, phone, email FROM contact_us_info WHERE is_active = 1 LIMIT 1');

            if (rows.length === 0) {
                return res.status(404).json({ success: false, message: 'No active contact info found' });
            }

            res.json({ success: true, data: rows[0] });
        } catch (err) {
            console.error('Get Contact Info Error:', err);
            res.status(500).json({ success: false, message: 'Internal server error' });
        } finally {
            if (conn) conn.release();
        }
    },

    sendMessage: async (req, res) => {
        const { name, email, phone, message } = req.body;

        if (!name || !email || !message) {
            return res.status(400).json({ success: false, message: 'Name, email, and message are required' });
        }

        let conn;
        try {
            // 1. Get the target email from the active contact info
            conn = await pool.getConnection();
            const [rows] = await conn.query('SELECT email FROM contact_us_info WHERE is_active = 1 LIMIT 1');
            const targetEmail = rows.length > 0 ? rows[0].email : process.env.GMAIL_USER;

            if (!process.env.GMAIL_USER || !process.env.GMAIL_PASS) {
                console.warn('⚠️ SMTP credentials not configured in .env');
                return res.status(503).json({ success: false, message: 'Email service not configured' });
            }

            // 2. Configure Nodemailer
            const transporter = nodemailer.createTransport({
                service: 'gmail',
                auth: {
                    user: process.env.GMAIL_USER,
                    pass: process.env.GMAIL_PASS,
                },
            });

            const mailOptions = {
                from: process.env.GMAIL_USER,
                to: targetEmail,
                subject: `New Contact Message from ${name}`,
                text: `
                    Name: ${name}
                    Email: ${email}
                    Phone: ${phone || 'N/A'}
                    
                    Message:
                    ${message}
                `,
            };

            // 3. Send Email
            await transporter.sendMail(mailOptions);

            res.json({ success: true, message: 'Message sent successfully' });
        } catch (err) {
            console.error('Send Message Error:', err);
            res.status(500).json({ success: false, message: 'Failed to send message' });
        } finally {
            if (conn) conn.release();
        }
    },

    submitComplaint: async (req, res) => {
        const userId = req.user?.userId || req.user?.id;
        const { service_type = 'Rider Support', priority = 'Medium', issue_description, category } = req.body;

        if (!userId) {
            return res.status(401).json({ success: false, message: 'Unauthorized. Please login again.' });
        }

        if (!issue_description) {
            return res.status(400).json({ success: false, message: 'Issue description is required' });
        }

        let conn;
        try {
            conn = await pool.getConnection();

            // Fetch user details
            const [users] = await conn.query('SELECT User_Name, Mobile, Cnic FROM users WHERE User_ID_Pk = ?', [userId]);
            if (users.length === 0) {
                return res.status(404).json({ success: false, message: 'User not found' });
            }

            const user = users[0];
            const fullName = user.User_Name || 'Unknown';
            const mobileNumber = user.Mobile || '';
            const cnicNumber = user.Cnic || null; // Cnic can be null
            const finalDescription = issue_description;
            const finalCategory = category || 'Other issue';

            const [result] = await conn.query(
                `INSERT INTO complaints 
                (user_id, full_name, mobile_number, category, issue_description)
                VALUES (?, ?, ?, ?, ?)`,
                [userId, fullName, mobileNumber, finalCategory, finalDescription]
            );

            res.json({ success: true, message: 'Complaint submitted successfully', complaint_id: result.insertId });
        } catch (err) {
            console.error('Submit Complaint Error:', err);
            res.status(500).json({ success: false, message: 'Failed to submit complaint', error: err.message });
        } finally {
            if (conn) conn.release();
        }
    }
};

module.exports = supportController;

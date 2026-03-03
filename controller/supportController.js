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
    }
};

module.exports = supportController;

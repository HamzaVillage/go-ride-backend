const pool = require('../db/Connect_Db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const authController = {
    sendOtp: async (req, res) => {
        const { phone_number } = req.body;
        if (!phone_number) return res.status(400).json({ success: false, message: "Phone number is required" });

        const otp = Math.floor(100000 + Math.random() * 900000).toString(); // 6 digit OTP
        const otp_hash = await bcrypt.hash(otp, 10);
        const expires_at = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes from now

        let conn;
        try {
            conn = await pool.getConnection();
            await conn.query(
                "INSERT INTO otp_verifications (phone_number, otp_hash, expires_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE otp_hash = ?, expires_at = ?, verified = 0, attempts = 0",
                [phone_number, otp_hash, expires_at, otp_hash, expires_at]
            );

            // In a real app, send OTP via SMS here. For now, we return it in response for testing.
            console.log(`OTP for ${phone_number}: ${otp}`);
            res.json({ success: true, message: "OTP sent successfully", otp: otp }); // Return OTP for dev purposes
        } catch (err) {
            console.error("OTP Error:", err);
            res.status(500).json({ success: false, message: "Error sending OTP", error: err.message });
        } finally {
            if (conn) conn.release();
        }
    },

    verifyOtp: async (req, res) => {
        const { phone_number, otp } = req.body;
        if (!phone_number || !otp) return res.status(400).json({ success: false, message: "Phone number and OTP are required" });

        let conn;
        try {
            conn = await pool.getConnection();
            const [rows] = await conn.query("SELECT * FROM otp_verifications WHERE phone_number = ? AND verified = 0 AND expires_at > NOW()", [phone_number]);

            if (rows.length === 0) return res.status(400).json({ success: false, message: "Invalid or expired OTP" });

            const otpData = rows[0];
            const valid = await bcrypt.compare(otp, otpData.otp_hash);
            if (!valid) {
                await conn.query("UPDATE otp_verifications SET attempts = attempts + 1 WHERE phone_number = ?", [phone_number]);
                return res.status(400).json({ success: false, message: "Invalid OTP" });
            }

            // Mark as verified
            await conn.query("UPDATE otp_verifications SET verified = 1 WHERE phone_number = ?", [phone_number]);

            // Fetch user to issue token
            const [userRows] = await conn.query("SELECT * FROM users WHERE Mobile = ?", [phone_number]);
            if (userRows.length === 0) {
                return res.status(404).json({ success: false, message: "User not found after verification" });
            }

            const user = userRows[0];
            const token = jwt.sign(
                { userId: user.User_ID_Pk, role: user.Role, phone: user.Mobile },
                process.env.JWT_SECRET || 'your_fallback_secret',
                { expiresIn: '7d' }
            );

            res.json({
                success: true,
                message: "OTP verified successfully",
                token,
                user: {
                    id: user.User_ID_Pk,
                    name: user.User_Name,
                    email: user.Email,
                    role: user.Role,
                    phone: user.Mobile
                }
            });
        } catch (err) {
            console.error("Verify OTP Error:", err);
            res.status(500).json({ success: false, message: "Error verifying OTP", error: err.message });
        } finally {
            if (conn) conn.release();
        }
    },

    register: async (req, res) => {
        const { full_name, email, phone, password, confirm_password } = req.body;

        if (!phone || !password || !full_name || !email) {
            return res.status(400).json({ success: false, message: "Missing required fields" });
        }

        if (password !== confirm_password) {
            return res.status(400).json({ success: false, message: "Passwords do not match" });
        }

        let conn;
        try {
            conn = await pool.getConnection();

            // Check if user already exists
            const [existing] = await conn.query("SELECT * FROM users WHERE Mobile = ? OR Email = ?", [phone, email]);
            if (existing.length > 0) {
                return res.status(400).json({ success: false, message: "User already exists with this phone or email" });
            }

            const hashedPassword = await bcrypt.hash(password, 10);
            const uniqueId = crypto.randomBytes(16).toString('hex');

            await conn.beginTransaction();

            // Insert into users table (Role defaults to rider)
            const [userResult] = await conn.query(
                `INSERT INTO users (User_Name, Email, Password, Mobile, Role, Unique_ID) 
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [full_name, email, hashedPassword, phone, 'rider', uniqueId]
            );

            const userId = userResult.insertId;

            // Also insert into drivers table if they are a rider
            const driverCode = 'DRV' + Math.floor(1000 + Math.random() * 9000);
            await conn.query(
                `INSERT INTO drivers (driver_code, full_name, phone, email, status)
                 VALUES (?, ?, ?, ?, ?)`,
                [driverCode, full_name, phone, email, 'pending']
            );

            await conn.commit();

            // Automatically send OTP after registration
            const otp = Math.floor(100000 + Math.random() * 900000).toString();
            const otp_hash = await bcrypt.hash(otp, 10);
            const expires_at = new Date(Date.now() + 10 * 60 * 1000);

            await conn.query(
                "INSERT INTO otp_verifications (phone_number, otp_hash, expires_at, purpose) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE otp_hash = ?, expires_at = ?, verified = 0, attempts = 0, purpose = ?",
                [phone, otp_hash, expires_at, 'register', otp_hash, expires_at, 'register']
            );

            console.log(`Registration OTP for ${phone}: ${otp}`);

            res.status(201).json({
                success: true,
                message: "Registration successful. OTP sent for verification.",
                otp: otp // Return for testing
            });
        } catch (err) {
            if (conn) await conn.rollback();
            console.error("Register Error:", err);
            res.status(500).json({ success: false, message: "Registration failed", error: err.message });
        } finally {
            if (conn) conn.release();
        }
    },

    login: async (req, res) => {
        const { phone, password } = req.body;

        if (!phone || !password) return res.status(400).json({ success: false, message: "Phone and password required" });

        let conn;
        try {
            conn = await pool.getConnection();
            const [rows] = await conn.query("SELECT * FROM users WHERE Mobile = ?", [phone]);
            if (rows.length === 0) return res.status(401).json({ success: false, message: "Invalid credentials" });

            const user = rows[0];
            const valid = await bcrypt.compare(password, user.Password);

            if (!valid) return res.status(401).json({ success: false, message: "Invalid credentials" });

            // Send OTP for login verification
            const otp = Math.floor(100000 + Math.random() * 900000).toString();
            const otp_hash = await bcrypt.hash(otp, 10);
            const expires_at = new Date(Date.now() + 10 * 60 * 1000);

            await conn.query(
                "INSERT INTO otp_verifications (phone_number, otp_hash, expires_at, purpose) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE otp_hash = ?, expires_at = ?, verified = 0, attempts = 0, purpose = ?",
                [phone, otp_hash, expires_at, 'login', otp_hash, expires_at, 'login']
            );

            console.log(`Login OTP for ${phone}: ${otp}`);

            res.json({
                success: true,
                message: "Credentials valid. OTP sent for verification.",
                otp: otp // Return for testing
            });
        } catch (err) {
            console.error("Login Error:", err);
            res.status(500).json({ success: false, message: "Login failed", error: err.message });
        } finally {
            if (conn) conn.release();
        }
    },

    logout: (req, res) => {
        // Since we use JWT, logout is usually handled on the client by deleting the token.
        // But we can send a success response.
        res.json({ success: true, message: "Logged out successfully" });
    }
};

module.exports = authController;

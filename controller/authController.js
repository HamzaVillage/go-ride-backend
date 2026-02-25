const pool = require('../db/Connect_Db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const axios = require('axios');
const FormData = require('form-data');

const sendSMS = async (mobile) => {
    try {
        const form = new FormData();
        form.append('mobile', mobile);

        const response = await axios.post('https://nexuscodelab.com/calling/send_otp.php', form, {
            headers: {
                ...form.getHeaders()
            }
        });

        if (response.data && response.data.sent && response.data.opt) {
            return response.data.opt.toString();
        }
        throw new Error("Failed to send SMS via external API");
    } catch (error) {
        console.error("SMS API Error:", error.message);
        throw error;
    }
};

const cleanupOTPs = async (pool) => {
    let conn;
    try {
        conn = await pool.getConnection();
        await conn.query("DELETE FROM otp_verifications WHERE expires_at < NOW() OR verified = 1");
    } catch (err) {
        console.error("OTP Cleanup Error:", err);
    } finally {
        if (conn) conn.release();
    }
};

const authController = {
    sendOtp: async (req, res) => {
        const { phone_number } = req.body;
        if (!phone_number) return res.status(400).json({ success: false, message: "Phone number is required" });

        try {
            const normalizedPhone = phone_number.replace(/-/g, '');
            await cleanupOTPs(pool);
            const otp = await sendSMS(normalizedPhone);
            const expires_at = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

            let conn;
            try {
                conn = await pool.getConnection();
                await conn.query(
                    "INSERT INTO otp_verifications (phone_number, otp_hash, expires_at, purpose) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE otp_hash = ?, expires_at = ?, verified = 0, attempts = 0, purpose = ?",
                    [normalizedPhone, otp, expires_at, 'general', otp, expires_at, 'general']
                );

                res.json({ success: true, message: "OTP sent successfully" });
            } finally {
                if (conn) conn.release();
            }
        } catch (err) {
            console.error("OTP Error:", err);
            res.status(500).json({ success: false, message: "Error sending OTP", error: err.message });
        }
    },

    verifyOtp: async (req, res) => {
        const { phone_number, otp } = req.body;
        if (!phone_number || !otp) return res.status(400).json({ success: false, message: "Phone number and OTP are required" });

        let conn;
        try {
            conn = await pool.getConnection();
            const normalizedPhone = phone_number.replace(/-/g, '');
            const [rows] = await conn.query("SELECT * FROM otp_verifications WHERE phone_number = ? AND verified = 0 AND expires_at > NOW()", [normalizedPhone]);

            if (rows.length === 0) return res.status(400).json({ success: false, message: "Invalid or expired OTP" });

            const otpData = rows[0];
            console.log(`🔑 OTP Compare: received='${otp}' stored='${otpData.otp_hash}'`);
            const valid = otp.toString().trim() === otpData.otp_hash.toString().trim();
            if (!valid) {
                await conn.query("UPDATE otp_verifications SET attempts = attempts + 1 WHERE phone_number = ?", [normalizedPhone]);
                return res.status(400).json({ success: false, message: "Invalid OTP" });
            }

            await conn.beginTransaction();

            let user;
            if (otpData.purpose === 'register') {
                const payload = JSON.parse(otpData.payload);
                const uniqueId = crypto.randomBytes(16).toString('hex');

                // Create User
                const [userResult] = await conn.query(
                    `INSERT INTO users (User_Name, Email, Password, Mobile, Role, Unique_ID) 
                     VALUES (?, ?, ?, ?, ?, ?)`,
                    [payload.full_name, payload.email, payload.password, normalizedPhone, 'rider', uniqueId]
                );

                const userId = userResult.insertId;

                const [newUserRows] = await conn.query("SELECT * FROM users WHERE User_ID_Pk = ?", [userId]);
                user = newUserRows[0];
            } else {
                // Exclude driver-role users so a rider with the same phone doesn't get the wrong account
                const [userRows] = await conn.query(
                    "SELECT * FROM users WHERE REPLACE(Mobile, '-', '') = ? AND (Role IS NULL OR Role != 'driver') ORDER BY User_ID_Pk ASC",
                    [normalizedPhone]
                );
                if (userRows.length === 0) {
                    await conn.rollback();
                    return res.status(404).json({ success: false, message: "User not found" });
                }
                user = userRows[0];
            }

            // Cleanup OTP
            await conn.query("DELETE FROM otp_verifications WHERE phone_number = ?", [normalizedPhone]);
            await conn.commit();

            const token = jwt.sign(
                { userId: user.User_ID_Pk, role: user.Role, phone: user.Mobile },
                process.env.JWT_SECRET || 'your_fallback_secret',
                { expiresIn: '7d' }
            );

            const responseData = {
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
            };

            // If driver, add extra data
            if (user.Role === 'driver') {
                const [driverRows] = await conn.query("SELECT * FROM drivers WHERE phone = ?", [phone_number]);
                if (driverRows.length > 0) {
                    responseData.driver_profile = driverRows[0];
                }
            }

            res.json(responseData);
        } catch (err) {
            if (conn) await conn.rollback();
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
            const normalizedPhone = phone.replace(/-/g, '');

            // Check if user already exists
            const [existing] = await conn.query("SELECT * FROM users WHERE REPLACE(Mobile, '-', '') = ? OR Email = ?", [normalizedPhone, email]);
            if (existing.length > 0) {
                return res.status(400).json({ success: false, message: "User already exists with this phone or email" });
            }

            await cleanupOTPs(pool);
            const otp = await sendSMS(normalizedPhone);
            const hashedPassword = await bcrypt.hash(password, 10);
            const expires_at = new Date(Date.now() + 10 * 60 * 1000);

            const payload = JSON.stringify({ full_name, email, password: hashedPassword });

            await conn.query(
                "INSERT INTO otp_verifications (phone_number, otp_hash, expires_at, purpose, payload) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE otp_hash = ?, expires_at = ?, verified = 0, attempts = 0, purpose = ?, payload = ?",
                [normalizedPhone, otp, expires_at, 'register', payload, otp, expires_at, 'register', payload]
            );

            res.status(200).json({
                success: true,
                message: "Registration OTP sent successfully. Please verify to complete account creation."
            });
        } catch (err) {
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
            const normalizedPhone = phone.replace(/-/g, '');
            const [rows] = await conn.query("SELECT * FROM users WHERE REPLACE(Mobile, '-', '') = ?", [normalizedPhone]);
            if (rows.length === 0) return res.status(401).json({ success: false, message: "Invalid credentials" });

            const user = rows[0];
            const valid = await bcrypt.compare(password, user.Password);

            if (!valid) return res.status(401).json({ success: false, message: "Invalid credentials" });

            await cleanupOTPs(pool);
            const otp = await sendSMS(normalizedPhone);
            const expires_at = new Date(Date.now() + 10 * 60 * 1000);

            console.log("OTP:", otp);

            await conn.query(
                "INSERT INTO otp_verifications (phone_number, otp_hash, expires_at, purpose) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE otp_hash = ?, expires_at = ?, verified = 0, attempts = 0, purpose = ?",
                [normalizedPhone, otp, expires_at, 'login', otp, expires_at, 'login']
            );

            res.json({
                success: true,
                message: "Credentials valid. OTP sent for verification."
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
    },

    driverSendOtp: async (req, res) => {
        const { phone } = req.body;
        if (!phone) return res.status(400).json({ success: false, message: "Phone number is required" });

        let conn;
        try {
            conn = await pool.getConnection();
            // Normalize input phone by removing any dashes
            const normalizedPhone = phone.replace(/-/g, '');

            // Check if driver exists in drivers table (comparison ignoring dashes in DB)
            const [driverRows] = await conn.query(
                "SELECT * FROM drivers WHERE REPLACE(phone, '-', '') = ?",
                [normalizedPhone]
            );
            if (driverRows.length === 0) {
                return res.status(404).json({ success: false, message: "Driver not registered. Please contact your franchise." });
            }

            const driver = driverRows[0];
            if (driver.status === 'blocked' || driver.status === 'inactive') {
                return res.status(403).json({ success: false, message: `Your account is ${driver.status}. Please contact support.` });
            }

            await cleanupOTPs(pool);
            const otp = await sendSMS(normalizedPhone);
            console.log("OTP:", otp);
            const expires_at = new Date(Date.now() + 10 * 60 * 1000);

            await conn.query(
                "INSERT INTO otp_verifications (phone_number, otp_hash, expires_at, purpose) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE otp_hash = ?, expires_at = ?, verified = 0, attempts = 0, purpose = ?",
                [normalizedPhone, otp, expires_at, 'driver_login', otp, expires_at, 'driver_login']
            );

            console.log(`📱 Debug Driver OTP for ${phone}: ${otp}`);
            res.json({ success: true, message: "OTP sent successfully" });
        } catch (err) {
            console.error("Driver Send OTP Error:", err);
            res.status(500).json({ success: false, message: "Failed to send OTP", error: err.message });
        } finally {
            if (conn) conn.release();
        }
    },

    driverVerifyOtp: async (req, res) => {
        const { phone, otp } = req.body;
        if (!phone || !otp) return res.status(400).json({ success: false, message: "Phone and OTP are required" });

        let conn;
        try {
            conn = await pool.getConnection();
            // Normalize input phone by removing any dashes
            const normalizedPhone = phone.replace(/-/g, '');

            // Verify OTP
            const [otpRows] = await conn.query(
                "SELECT * FROM otp_verifications WHERE phone_number = ? AND purpose = 'driver_login' AND verified = 0 AND expires_at > NOW()",
                [normalizedPhone]
            );

            if (otpRows.length === 0) {
                return res.status(400).json({ success: false, message: "Invalid or expired OTP" });
            }

            const otpData = otpRows[0];
            console.log(`🔑 Driver OTP Compare: received='${otp}' stored='${otpData.otp_hash}'`);
            const isMatch = otp.toString().trim() === otpData.otp_hash.toString().trim();

            if (!isMatch) {
                await conn.query("UPDATE otp_verifications SET attempts = attempts + 1 WHERE phone_number = ?", [normalizedPhone]);
                return res.status(400).json({ success: false, message: "Invalid OTP" });
            }

            // Get driver details (normalized comparison)
            const [driverRows] = await conn.query(
                "SELECT * FROM drivers WHERE REPLACE(phone, '-', '') = ?",
                [normalizedPhone]
            );
            if (driverRows.length === 0) return res.status(404).json({ success: false, message: "Driver details not found" });

            const driver = driverRows[0];

            // Optional: Ensure user exists in users table for consistent JWT/Auth
            const [userRows] = await conn.query(
                "SELECT * FROM users WHERE REPLACE(Mobile, '-', '') = ? AND Role = 'driver'",
                [normalizedPhone]
            );
            let userId;
            if (userRows.length === 0) {
                // Create user if not exists
                const uniqueId = crypto.randomBytes(16).toString('hex');
                const [userResult] = await conn.query(
                    "INSERT INTO users (User_Name, Email, Mobile, Role, Unique_ID) VALUES (?, ?, ?, ?, ?)",
                    [driver.full_name, driver.email || '', phone, 'driver', uniqueId]
                );
                userId = userResult.insertId;
            } else {
                userId = userRows[0].User_ID_Pk;
            }

            // Cleanup OTP
            await conn.query("DELETE FROM otp_verifications WHERE phone_number = ? AND purpose = 'driver_login'", [normalizedPhone]);

            const token = jwt.sign(
                { userId, role: 'driver', phone: phone },
                process.env.JWT_SECRET || 'your_fallback_secret',
                { expiresIn: '30d' }
            );

            res.json({
                success: true,
                message: "Driver logged in successfully",
                token,
                user: {
                    id: userId,
                    name: driver.full_name,
                    phone: driver.phone,
                    role: 'driver'
                },
                driver_profile: driver
            });
        } catch (err) {
            console.error("Driver Verify OTP Error:", err);
            res.status(500).json({ success: false, message: "Verification failed", error: err.message });
        } finally {
            if (conn) conn.release();
        }
    },

    forgotPassword: async (req, res) => {
        const { phone } = req.body;
        if (!phone) return res.status(400).json({ success: false, message: "Phone number is required" });

        let conn;
        try {
            conn = await pool.getConnection();
            const normalizedPhone = phone.replace(/-/g, '');
            const [rows] = await conn.query("SELECT User_ID_Pk FROM users WHERE REPLACE(Mobile, '-', '') = ?", [normalizedPhone]);
            if (rows.length === 0) return res.status(404).json({ success: false, message: "User not found" });

            await cleanupOTPs(pool);
            const otp = await sendSMS(normalizedPhone);
            const expires_at = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

            await conn.query(
                "INSERT INTO otp_verifications (phone_number, otp_hash, expires_at, purpose) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE otp_hash = ?, expires_at = ?, verified = 0, attempts = 0, purpose = ?",
                [normalizedPhone, otp, expires_at, 'forgot_password', otp, expires_at, 'forgot_password']
            );

            res.json({ success: true, message: "Reset OTP sent successfully" });
        } catch (err) {
            console.error("Forgot Password Error:", err);
            res.status(500).json({ success: false, message: "Error sending reset OTP", error: err.message });
        } finally {
            if (conn) conn.release();
        }
    },

    resetPassword: async (req, res) => {
        const { phone, otp, new_password, confirm_password } = req.body;

        if (!phone || !otp || !new_password || !confirm_password) {
            return res.status(400).json({ success: false, message: "Missing required fields" });
        }

        if (new_password !== confirm_password) {
            return res.status(400).json({ success: false, message: "Passwords do not match" });
        }

        let conn;
        try {
            conn = await pool.getConnection();
            const normalizedPhone = phone.replace(/-/g, '');
            const [rows] = await conn.query(
                "SELECT * FROM otp_verifications WHERE phone_number = ? AND purpose = 'forgot_password' AND verified = 0 AND expires_at > NOW()",
                [normalizedPhone]
            );

            if (rows.length === 0) return res.status(400).json({ success: false, message: "Invalid or expired OTP" });

            const otpData = rows[0];
            console.log(`🔑 Reset OTP Compare: received='${otp}' stored='${otpData.otp_hash}'`);
            const valid = otp.toString().trim() === otpData.otp_hash.toString().trim();
            if (!valid) {
                await conn.query("UPDATE otp_verifications SET attempts = attempts + 1 WHERE phone_number = ?", [normalizedPhone]);
                return res.status(400).json({ success: false, message: "Invalid OTP" });
            }

            const hashedPassword = await bcrypt.hash(new_password, 10);

            await conn.beginTransaction();
            // Update password
            await conn.query("UPDATE users SET Password = ? WHERE REPLACE(Mobile, '-', '') = ?", [hashedPassword, normalizedPhone]);
            // Delete OTP
            await conn.query("DELETE FROM otp_verifications WHERE phone_number = ? AND purpose = 'forgot_password'", [normalizedPhone]);
            await conn.commit();

            res.json({ success: true, message: "Password reset successfully" });
        } catch (err) {
            if (conn) await conn.rollback();
            console.error("Reset Password Error:", err);
            res.status(500).json({ success: false, message: "Error resetting password", error: err.message });
        } finally {
            if (conn) conn.release();
        }
    }
};

module.exports = authController;

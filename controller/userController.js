const pool = require('../db/Connect_Db');

const userController = {
    getProfile: async (req, res) => {
        const userId = req.user.userId;

        let conn;
        try {
            conn = await pool.getConnection();
            const [rows] = await conn.query("SELECT User_ID_Pk, User_Name, Email, Mobile, Role, Cnic, Address, City, User_Pic FROM users WHERE User_ID_Pk = ?", [userId]);

            if (rows.length === 0) return res.status(404).json({ success: false, message: "User not found" });

            res.json({ success: true, data: rows[0] });
        } catch (err) {
            console.error("Get Profile Error:", err);
            res.status(500).json({ success: false, message: "Error fetching profile", error: err.message });
        } finally {
            if (conn) conn.release();
        }
    },

    updateProfile: async (req, res) => {
        const userId = req.user.userId;
        const { full_name, email, cnic, address, city } = req.body;

        let conn;
        try {
            conn = await pool.getConnection();
            await conn.query(
                "UPDATE users SET User_Name = ?, Email = ?, Cnic = ?, Address = ?, City = ? WHERE User_ID_Pk = ?",
                [full_name, email, cnic, address, city, userId]
            );

            res.json({ success: true, message: "Profile updated successfully" });
        } catch (err) {
            console.error("Update Profile Error:", err);
            res.status(500).json({ success: false, message: "Error updating profile", error: err.message });
        } finally {
            if (conn) conn.release();
        }
    },

    getDriverAccount: async (req, res) => {
        const user = req.user;
        let conn;
        try {
            conn = await pool.getConnection();
            const [rows] = await conn.query(
                `SELECT id, full_name, father_name, cnic, phone, email, address, city, dob,
                        vehicle_type, vehicle_model, vehicle_number, vehicle_color,
                        photo_path, Rating, join_date, completed_rides_count,
                        Easypaisa, Easypaisa_Active, JazzCash, JazzCash_Active
                 FROM drivers WHERE User_ID_FK = ? OR REPLACE(phone, '-', '') = REPLACE(?, '-', '')`,
                [user.userId || 0, user.phone]
            );
            if (rows.length === 0) return res.status(404).json({ success: false, message: "Driver profile not found" });
            res.json({ success: true, data: rows[0] });
        } catch (err) {
            console.error("Get Driver Account Error:", err);
            res.status(500).json({ success: false, message: "Error fetching driver account", error: err.message });
        } finally {
            if (conn) conn.release();
        }
    },

    updateDriverAccount: async (req, res) => {
        const user = req.user;
        const { full_name, email, address, city, easypaisa, jazzcash } = req.body;
        let conn;
        try {
            conn = await pool.getConnection();
            const [driverRows] = await conn.query(
                "SELECT id FROM drivers WHERE User_ID_FK = ? OR REPLACE(phone, '-', '') = REPLACE(?, '-', '')",
                [user.userId || 0, user.phone]
            );
            if (driverRows.length === 0) {
                return res.status(404).json({ success: false, message: "Driver profile not found" });
            }

            const fields = [];
            const values = [];

            if (full_name !== undefined) { fields.push('full_name = ?'); values.push(full_name); }
            if (email !== undefined) { fields.push('email = ?'); values.push(email); }
            if (address !== undefined) { fields.push('address = ?'); values.push(address); }
            if (city !== undefined) { fields.push('city = ?'); values.push(city); }
            if (easypaisa !== undefined) { fields.push('Easypaisa = ?'); values.push(easypaisa); }
            if (jazzcash !== undefined) { fields.push('JazzCash = ?'); values.push(jazzcash); }

            if (fields.length === 0) {
                return res.status(400).json({ success: false, message: "No fields to update" });
            }

            values.push(driverRows[0].id);
            await conn.query(`UPDATE drivers SET ${fields.join(', ')} WHERE id = ?`, values);

            res.json({ success: true, message: "Driver profile updated successfully" });
        } catch (err) {
            console.error("Update Driver Account Error:", err);
            res.status(500).json({ success: false, message: "Error updating driver account", error: err.message });
        } finally {
            if (conn) conn.release();
        }
    },

    updateFcmToken: async (req, res) => {
        const userId = req.user.userId;
        const role = req.user.role;
        const phone = req.user.phone;
        const { fcm_token } = req.body;

        if (!fcm_token || typeof fcm_token !== 'string' || !fcm_token.trim()) {
            return res.status(400).json({ success: false, message: "fcm_token is required" });
        }

        const token = fcm_token.trim();
        let conn;
        try {
            conn = await pool.getConnection();
            await conn.query(
                "UPDATE users SET fcm_token = ?, fcm_token_updated_at = CURRENT_TIMESTAMP WHERE User_ID_Pk = ?",
                [token, userId]
            );

            if (role === 'driver' && phone) {
                const normalizedPhone = String(phone).replace(/-/g, '');
                const [driverRows] = await conn.query(
                    "SELECT id FROM drivers WHERE User_ID_FK = ? OR REPLACE(phone, '-', '') = REPLACE(?, '-', '')",
                    [userId, phone]
                );
                if (driverRows.length > 0) {
                    await conn.query(
                        "UPDATE drivers SET fcm_token = ?, fcm_token_updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                        [token, driverRows[0].id]
                    );
                    console.log('🔔 [FCM] Token saved for driver id=', driverRows[0].id);
                }
            }

            console.log('🔔 [FCM] Token saved for userId=', userId, 'tokenPreview=', token.slice(0, 8) + '...' + token.slice(-8));
            res.json({ success: true, message: "FCM token updated" });
        } catch (err) {
            console.error("Update FCM Token Error:", err);
            res.status(500).json({ success: false, message: "Error updating FCM token", error: err.message });
        } finally {
            if (conn) conn.release();
        }
    },

    updateProfilePicture: async (req, res) => {
        const userId = req.user.userId;
        const role = req.user.role;
        const phone = req.user.phone;

        if (!req.file) {
            return res.status(400).json({ success: false, message: "No file uploaded" });
        }

        const fileName = req.file.filename;
        let conn;
        try {
            conn = await pool.getConnection();

            // Update users table (common for both roles as secondary record)
            await conn.query(
                "UPDATE users SET User_Pic = ? WHERE User_ID_Pk = ?",
                [fileName, userId]
            );

            // If driver, also update drivers table
            if (role === 'driver' && phone) {
                const normalizedPhone = String(phone).replace(/-/g, '');
                await conn.query(
                    "UPDATE drivers SET photo_path = ? WHERE User_ID_FK = ? OR REPLACE(phone, '-', '') = REPLACE(?, '-', '')",
                    [fileName, userId, phone]
                );
            }

            res.json({
                success: true,
                message: "Profile picture updated successfully",
                fileName: fileName
            });
        } catch (err) {
            console.error("Update Profile Picture Error:", err);
            res.status(500).json({ success: false, message: "Error updating profile picture", error: err.message });
        } finally {
            if (conn) conn.release();
        }
    },

    getDriverStatus: async (req, res) => {
        const user = req.user;
        let conn;
        try {
            conn = await pool.getConnection();
            const normalizedPhone = String(user.phone).replace(/-/g, '');
            const [rows] = await conn.query(
                "SELECT status FROM drivers WHERE User_ID_FK = ? OR REPLACE(phone, '-', '') = REPLACE(?, '-', '')",
                [user.userId || 0, user.phone]
            );
            if (rows.length === 0) {
                return res.json({ success: true, exists: false });
            }
            res.json({ success: true, exists: true, status: rows[0].status });
        } catch (err) {
            console.error("Get Driver Status Error:", err);
            res.status(500).json({ success: false, message: "Error checking driver status", error: err.message });
        } finally {
            if (conn) conn.release();
        }
    },

    registerDriver: async (req, res) => {
        let conn;
        try {
            const {
                Name,
                FatherName,
                Cnic,
                DOB,
                Mobile,
                Email,
                Address,
                City,
                Vehicle_Type,
                Vehicle_Model,
                Vehicle_Number,
                Vehicle_Color,
                EasyPaisa,
                JazzCash,
                Password
            } = req.body;

            // Simple validation
            if (!Name || !Cnic || !DOB || !Mobile || !Address || !City || !Vehicle_Type || !Vehicle_Model || !Vehicle_Number || !Vehicle_Color) {
                return res.status(400).json({ success: false, message: "Missing required onboarding fields" });
            }

            conn = await pool.getConnection();

            // Check if phone number already registered as driver
            const normalizedPhone = String(Mobile).replace(/-/g, '');
            const [existing] = await conn.query(
                "SELECT id FROM drivers WHERE REPLACE(phone, '-', '') = ?",
                [normalizedPhone]
            );
            if (existing.length > 0) {
                return res.status(400).json({ success: false, message: "A driver with this phone number is already registered" });
            }

            // Extract file paths if uploaded
            const photo_path = req.files && req.files['Photo'] ? req.files['Photo'][0].filename : null;
            const cnic_front_path = req.files && req.files['CNIC_Front'] ? req.files['CNIC_Front'][0].filename : null;
            const cnic_back_path = req.files && req.files['CNIC_Back'] ? req.files['CNIC_Back'][0].filename : null;
            const license_path = req.files && req.files['License'] ? req.files['License'][0].filename : null;

            // Generate driver code (e.g., DRV-123456)
            const driver_code = 'DRV-' + Math.floor(100000 + Math.random() * 900000);

            // Match to existing user if phone exists
            let userIdFK = null;
            const [matchingUser] = await conn.query(
                "SELECT User_ID_Pk FROM users WHERE REPLACE(Mobile, '-', '') = ? LIMIT 1",
                [normalizedPhone]
            );
            if (matchingUser.length > 0) {
                userIdFK = matchingUser[0].User_ID_Pk;
            } else {
                // Create user record in users table if it does not exist
                const crypto = require('crypto');
                const bcrypt = require('bcryptjs');
                const uniqueId = crypto.randomBytes(16).toString('hex');
                const hashedPassword = await bcrypt.hash(Password || '12345', 10);
                
                const [newUserResult] = await conn.query(
                    `INSERT INTO users (User_Name, Email, Password, Mobile, Role, Unique_ID) 
                     VALUES (?, ?, ?, ?, ?, ?)`,
                    [Name, Email || null, hashedPassword, normalizedPhone, 'driver', uniqueId]
                );
                userIdFK = newUserResult.insertId;
            }

            // Format CNIC to fit varchar(15) db column
            const dbCnic = String(Cnic).slice(0, 15);

            // Convert DOB from dd/mm/yyyy or dd-mm-yyyy to yyyy-mm-dd format
            let dbDob = DOB;
            if (DOB) {
                const cleanDob = String(DOB).trim();
                const parts = cleanDob.split(/[\/\-]/);
                if (parts.length === 3) {
                    let year = parts[2];
                    if (year.length === 2) {
                        year = parseInt(year) > 26 ? `19${year}` : `20${year}`;
                    }
                    if (parts[0].length === 4) {
                        dbDob = cleanDob;
                    } else {
                        const p0 = parseInt(parts[0]);
                        const p1 = parseInt(parts[1]);
                        let day = p0;
                        let month = p1;
                        if (p1 > 12) {
                            day = p1;
                            month = p0;
                        }
                        const formattedMonth = String(month).padStart(2, '0');
                        const formattedDay = String(day).padStart(2, '0');
                        dbDob = `${year}-${formattedMonth}-${formattedDay}`;
                    }
                }
            }

            const query = `
                INSERT INTO drivers (
                    User_ID_FK, driver_code, full_name, father_name, cnic, 
                    Easypaisa, JazzCash, dob, phone, email, 
                    address, city, vehicle_type, vehicle_model, vehicle_number, 
                    vehicle_color, photo_path, cnic_front_path, cnic_back_path, license_path, 
                    status, join_date, password
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURDATE(), ?)
            `;

            await conn.query(query, [
                userIdFK,
                driver_code,
                Name,
                FatherName || null,
                dbCnic,
                EasyPaisa || null,
                JazzCash || null,
                dbDob,
                Mobile,
                Email || null,
                Address,
                City,
                Vehicle_Type,
                Vehicle_Model,
                Vehicle_Number,
                Vehicle_Color,
                photo_path,
                cnic_front_path,
                cnic_back_path,
                license_path,
                'pending',
                Password || '12345'
            ]);

            res.json({ success: true, message: "Driver registration request submitted successfully!" });
        } catch (err) {
            console.error("Register Driver Error:", err);
            res.status(500).json({ success: false, message: "Error registering driver", error: err.message });
        } finally {
            if (conn) conn.release();
        }
    }
};

module.exports = userController;

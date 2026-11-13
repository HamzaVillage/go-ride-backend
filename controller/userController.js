const pool = require('../db/Connect_Db');
const { getFcmTokenForUser, getFcmTokenForDriver, sendSilentLocationPing } = require('../services/pushNotificationService');
const { getIO } = require('../socket/socketManager');
const { formatDriverCode } = require('../utils/driverHelper');

const getFullUploadUrl = (filename) => {
    if (!filename) return null;
    if (filename.startsWith('http://') || filename.startsWith('https://')) return filename;
    const base = (process.env.BASE_UPLOAD_URL || "https://kinetworksportal.com/uploads/").replace(/\/?$/, '/');
    return `${base}${filename}`;
};

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
                        photo_path, cnic_front_path, cnic_back_path, license_path, vehicle_doc_path,
                        Rating, join_date, completed_rides_count,
                        Easypaisa, Easypaisa_Active, JazzCash, JazzCash_Active
                 FROM drivers WHERE User_ID_FK = ? OR REPLACE(phone, '-', '') = REPLACE(?, '-', '')`,
                [user.userId || 0, user.phone]
            );
            if (rows.length === 0) return res.status(404).json({ success: false, message: "Driver profile not found" });
            const driverRow = rows[0];
            res.json({
                success: true,
                data: {
                    ...driverRow,
                    driver_code: formatDriverCode(driverRow.id),
                }
            });
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

        const fullFileUrl = getFullUploadUrl(req.file.filename);
        let conn;
        try {
            conn = await pool.getConnection();

            // Update users table (common for both roles as secondary record)
            await conn.query(
                "UPDATE users SET User_Pic = ? WHERE User_ID_Pk = ?",
                [fullFileUrl, userId]
            );

            // If driver, also update drivers table
            if (role === 'driver' && phone) {
                const normalizedPhone = String(phone).replace(/-/g, '');
                await conn.query(
                    "UPDATE drivers SET photo_path = ? WHERE User_ID_FK = ? OR REPLACE(phone, '-', '') = REPLACE(?, '-', '')",
                    [fullFileUrl, userId, phone]
                );
            }

            res.json({
                success: true,
                message: "Profile picture updated successfully",
                fileName: fullFileUrl
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
            res.json({ success: true, exists: true, status: String(rows[0].status || '').trim().toLowerCase() });
        } catch (err) {
            console.error("Get Driver Status Error:", err);
            res.status(500).json({ success: false, message: "Error checking driver status", error: err.message });
        } finally {
            if (conn) conn.release();
        }
    },

    registerDriver: async (req,res) => {
        try {
            const {createNormalDriverEnrollment}=require('../services/normalDriverEnrollment');
            const service=createNormalDriverEnrollment(pool);
            const files={};for(const field of ['Photo','CNIC_Front','CNIC_Back','License','Vehicle_Running_Page']){
                const file=req.files?.[field]?.[0] || (field==='Vehicle_Running_Page'?req.files?.Vehicle_Doc?.[0]:null);
                if(file)files[field]=getFullUploadUrl(file.filename);
            }
            const result=req.user ? await service.enroll(req.user.userId,req.body,files) : await service.registerPublic(req.body,files);
            res.json({success:true,message:'Driver registration request submitted successfully!',...result});
        }catch(error){if(!error.status)console.error('Register Driver Error:',error.code||'INTERNAL_ERROR');res.status(error.status||500).json({success:false,message:error.status?error.message:'Error registering driver'});}
    },

    pingUserLocation: async (req, res) => {
        const targetUserId = req.params.userId || req.body.userId;
        const requesterId = req.user?.userId || null;

        if (!targetUserId) {
            return res.status(400).json({ success: false, message: "Target userId is required" });
        }

        try {
            // Find FCM token from users or drivers
            let token = await getFcmTokenForUser(targetUserId);
            if (!token) {
                token = await getFcmTokenForDriver(targetUserId);
            }

            if (!token) {
                return res.status(404).json({
                    success: false,
                    message: "User device FCM token not found. User must have opened the app at least once."
                });
            }

            const sent = await sendSilentLocationPing(token, targetUserId, requesterId);
            if (sent) {
                res.json({
                    success: true,
                    message: "Silent location ping sent to user device",
                    targetUserId
                });
            } else {
                res.status(500).json({
                    success: false,
                    message: "Failed to deliver silent push notification"
                });
            }
        } catch (err) {
            console.error("Ping User Location Error:", err);
            res.status(500).json({ success: false, message: "Error pinging user location", error: err.message });
        }
    },

    submitLiveLocation: async (req, res) => {
        const {
            latitude,
            longitude,
            heading,
            speed,
            accuracy,
            battery_level,
            targetUserId,
            userId,
            role
        } = req.body;

        const effectiveUserId = targetUserId || userId || req.user?.userId;
        if (!effectiveUserId || latitude === undefined || longitude === undefined) {
            return res.status(400).json({ success: false, message: "userId, latitude, and longitude are required" });
        }

        let conn;
        try {
            conn = await pool.getConnection();
            const effectiveRole = role || req.user?.role || 'rider';

            // Insert or update live coordinates in user_live_locations
            await conn.query(`
                INSERT INTO user_live_locations (
                    user_id, role, latitude, longitude, heading, speed, accuracy, battery_level, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON DUPLICATE KEY UPDATE
                    role = VALUES(role),
                    latitude = VALUES(latitude),
                    longitude = VALUES(longitude),
                    heading = VALUES(heading),
                    speed = VALUES(speed),
                    accuracy = VALUES(accuracy),
                    battery_level = VALUES(battery_level),
                    updated_at = CURRENT_TIMESTAMP
            `, [
                effectiveUserId,
                effectiveRole,
                latitude,
                longitude,
                heading || null,
                speed || null,
                accuracy || null,
                battery_level || null
            ]);

            // Emit socket event if socketManager is available
            try {
                const io = getIO();
                if (io) {
                    const payload = {
                        userId: effectiveUserId,
                        latitude,
                        longitude,
                        heading: heading || 0,
                        speed: speed || 0,
                        accuracy: accuracy || 0,
                        battery_level: battery_level || null,
                        updated_at: new Date().toISOString()
                    };
                    io.emit(`user_location_${effectiveUserId}`, payload);
                    io.emit('live_location_broadcast', payload);
                }
            } catch (socketErr) {
                // Ignore socket emit error if socket is not initialized
            }

            console.log(`📍 [Live Location] Recorded coordinates for user ${effectiveUserId}: ${latitude}, ${longitude}`);
            res.json({ success: true, message: "Location updated successfully" });
        } catch (err) {
            console.error("Submit Live Location Error:", err);
            res.status(500).json({ success: false, message: "Error submitting location", error: err.message });
        } finally {
            if (conn) conn.release();
        }
    },

    getLatestLocation: async (req, res) => {
        const targetUserId = req.params.userId || req.query.userId;
        if (!targetUserId) {
            return res.status(400).json({ success: false, message: "userId parameter is required" });
        }

        let conn;
        try {
            conn = await pool.getConnection();
            const [rows] = await conn.query(
                "SELECT user_id, role, latitude, longitude, heading, speed, accuracy, battery_level, updated_at FROM user_live_locations WHERE user_id = ?",
                [targetUserId]
            );

            if (rows.length === 0) {
                return res.status(404).json({ success: false, message: "No location records found for this user" });
            }

            res.json({ success: true, location: rows[0] });
        } catch (err) {
            console.error("Get Latest Location Error:", err);
            res.status(500).json({ success: false, message: "Error fetching user location", error: err.message });
        } finally {
            if (conn) conn.release();
        }
    }
};

module.exports = userController;

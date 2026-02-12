const pool = require("../db/Connect_Db");

const addressController = {
    // Add a new address
    addAddress: async (req, res) => {
        const { title, address, lat, lng, city, note, is_default } = req.body;
        const user = req.user;

        if (!title || !address) {
            return res.status(400).json({ success: false, message: "Title and address are required" });
        }

        let conn;
        try {
            conn = await pool.getConnection();

            // If setting as default, unset all other defaults first
            if (is_default) {
                await conn.query(
                    "UPDATE user_addresses SET Is_Default = 0 WHERE User_ID_Fk = ?",
                    [user.userId]
                );
            }

            const [result] = await conn.query(
                `INSERT INTO user_addresses (User_ID_Fk, Title, Address, Lat, Lng, City, Note, Is_Default) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [user.userId, title, address, lat || null, lng || null, city || null, note || null, is_default ? 1 : 0]
            );

            res.status(201).json({
                success: true,
                message: "Address saved successfully",
                data: { address_id: result.insertId }
            });
        } catch (err) {
            console.error("Add Address Error:", err);
            res.status(500).json({ success: false, message: "Error saving address", error: err.message });
        } finally {
            if (conn) conn.release();
        }
    },

    // Get all addresses for the logged-in user
    getAddresses: async (req, res) => {
        const user = req.user;

        let conn;
        try {
            conn = await pool.getConnection();

            const [addresses] = await conn.query(
                "SELECT * FROM user_addresses WHERE User_ID_Fk = ? ORDER BY Is_Default DESC, CreatedAt DESC",
                [user.userId]
            );

            res.json({ success: true, count: addresses.length, data: addresses });
        } catch (err) {
            console.error("Get Addresses Error:", err);
            res.status(500).json({ success: false, message: "Error fetching addresses", error: err.message });
        } finally {
            if (conn) conn.release();
        }
    },

    // Get a single address by ID
    getAddressById: async (req, res) => {
        const { id } = req.params;
        const user = req.user;

        let conn;
        try {
            conn = await pool.getConnection();

            const [addresses] = await conn.query(
                "SELECT * FROM user_addresses WHERE Address_ID_Pk = ? AND User_ID_Fk = ?",
                [id, user.userId]
            );

            if (addresses.length === 0) {
                return res.status(404).json({ success: false, message: "Address not found" });
            }

            res.json({ success: true, data: addresses[0] });
        } catch (err) {
            console.error("Get Address Error:", err);
            res.status(500).json({ success: false, message: "Error fetching address", error: err.message });
        } finally {
            if (conn) conn.release();
        }
    },

    // Update an address
    updateAddress: async (req, res) => {
        const { id } = req.params;
        const { title, address, lat, lng, city, note, is_default } = req.body;
        const user = req.user;

        let conn;
        try {
            conn = await pool.getConnection();

            // Check ownership
            const [existing] = await conn.query(
                "SELECT * FROM user_addresses WHERE Address_ID_Pk = ? AND User_ID_Fk = ?",
                [id, user.userId]
            );

            if (existing.length === 0) {
                return res.status(404).json({ success: false, message: "Address not found" });
            }

            // If setting as default, unset all other defaults first
            if (is_default) {
                await conn.query(
                    "UPDATE user_addresses SET Is_Default = 0 WHERE User_ID_Fk = ?",
                    [user.userId]
                );
            }

            await conn.query(
                `UPDATE user_addresses SET 
                    Title = ?, Address = ?, Lat = ?, Lng = ?, 
                    City = ?, Note = ?, Is_Default = ?
                 WHERE Address_ID_Pk = ? AND User_ID_Fk = ?`,
                [
                    title || existing[0].Title,
                    address || existing[0].Address,
                    lat !== undefined ? lat : existing[0].Lat,
                    lng !== undefined ? lng : existing[0].Lng,
                    city || existing[0].City,
                    note !== undefined ? note : existing[0].Note,
                    is_default !== undefined ? (is_default ? 1 : 0) : existing[0].Is_Default,
                    id,
                    user.userId
                ]
            );

            res.json({ success: true, message: "Address updated successfully" });
        } catch (err) {
            console.error("Update Address Error:", err);
            res.status(500).json({ success: false, message: "Error updating address", error: err.message });
        } finally {
            if (conn) conn.release();
        }
    },

    // Delete an address
    deleteAddress: async (req, res) => {
        const { id } = req.params;
        const user = req.user;

        let conn;
        try {
            conn = await pool.getConnection();

            const [result] = await conn.query(
                "DELETE FROM user_addresses WHERE Address_ID_Pk = ? AND User_ID_Fk = ?",
                [id, user.userId]
            );

            if (result.affectedRows === 0) {
                return res.status(404).json({ success: false, message: "Address not found" });
            }

            res.json({ success: true, message: "Address deleted successfully" });
        } catch (err) {
            console.error("Delete Address Error:", err);
            res.status(500).json({ success: false, message: "Error deleting address", error: err.message });
        } finally {
            if (conn) conn.release();
        }
    }
};

module.exports = addressController;

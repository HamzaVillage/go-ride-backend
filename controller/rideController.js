const pool = require('../db/Connect_Db');

const rideController = {
    createRide: async (req, res) => {
        const {
            user_id, pickup_location, drop_location, pickup_lat, pickup_lng,
            drop_lat, drop_lng, distance, duration, fare, base_fare,
            per_km_rate, night_charge, peak_hour_surcharge, total_waiting_time,
            waiting_charges, is_peak_hour, is_night_ride, payment_method,
            vehicle_type, ride_date, start_time
        } = req.body;

        if (!user_id || !pickup_location || !drop_location || !pickup_lat || !pickup_lng) {
            return res.status(400).json({ success: false, message: "Missing required fields for ride creation" });
        }

        let conn;
        try {
            conn = await pool.getConnection();
            const [result] = await conn.query(
                `INSERT INTO ride_history (
                    User_ID_Fk, Pickup_Location, Drop_Location, Pickup_Lat, Pickup_Lng, 
                    Drop_Lat, Drop_Lng, Distance, Duration, Fare, Base_Fare, 
                    Per_Km_Rate, Night_Charge, Peak_Hour_Surcharge, Total_Waiting_Time, 
                    Waiting_Charges, Is_Peak_Hour, Is_Night_Ride, Payment_Method, 
                    Vehicle_Type, Ride_Status, Ride_Date, Start_Time
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    user_id, pickup_location, drop_location, pickup_lat, pickup_lng,
                    drop_lat, drop_lng, distance, duration, fare, base_fare,
                    per_km_rate, night_charge, peak_hour_surcharge, total_waiting_time,
                    waiting_charges, is_peak_hour ? 1 : 0, is_night_ride ? 1 : 0, payment_method,
                    vehicle_type, 'Requested', ride_date || new Date(), start_time || new Date()
                ]
            );

            res.status(201).json({
                success: true,
                message: "Ride created successfully",
                rideId: result.insertId
            });
        } catch (err) {
            console.error("Create Ride Error:", err);
            res.status(500).json({ success: false, message: "Error creating ride", error: err.message });
        } finally {
            if (conn) conn.release();
        }
    },

    getNearbyRides: async (req, res) => {
        const { driver_lat, driver_lng } = req.query;

        if (!driver_lat || !driver_lng) {
            return res.status(400).json({ success: false, message: "Driver location (lat/lng) is required" });
        }

        let conn;
        try {
            conn = await pool.getConnection();

            // Haversine formula to find rides within 1km where Driver_ID_Fk IS NULL
            const query = `
                SELECT *, 
                (6371 * acos(cos(radians(?)) * cos(radians(Pickup_Lat)) * cos(radians(Pickup_Lng) - radians(?)) + sin(radians(?)) * sin(radians(Pickup_Lat)))) AS distance_km
                FROM ride_history
                WHERE Driver_ID_Fk IS NULL AND Ride_Status = 'Requested'
                HAVING distance_km < 1
                ORDER BY distance_km ASC
            `;

            const [rides] = await conn.query(query, [driver_lat, driver_lng, driver_lat]);

            res.json({ success: true, count: rides.length, data: rides });
        } catch (err) {
            console.error("Get Nearby Rides Error:", err);
            res.status(500).json({ success: false, message: "Error fetching nearby rides", error: err.message });
        } finally {
            if (conn) conn.release();
        }
    },

    makeOffer: async (req, res) => {
        const { request_id, driver_id, offered_fare } = req.body;

        if (!request_id || !driver_id || !offered_fare) {
            return res.status(400).json({ success: false, message: "Missing required fields" });
        }

        let conn;
        try {
            conn = await pool.getConnection();

            // 1. Validate that the ride exists and is still in 'Requested' status
            const [rides] = await conn.query(
                "SELECT Ride_Status, Driver_ID_Fk FROM ride_history WHERE Ride_ID_Pk = ?",
                [request_id]
            );

            if (rides.length === 0) {
                return res.status(404).json({ success: false, message: "Ride request not found" });
            }

            const ride = rides[0];
            if (ride.Ride_Status !== 'Requested' || ride.Driver_ID_Fk !== null) {
                return res.status(400).json({ success: false, message: "This ride is no longer open for offers" });
            }

            // 2. Set expiry to 1 minute from now
            const expires_at = new Date(Date.now() + 60 * 1000);

            const [result] = await conn.query(
                `INSERT INTO driver_fare_offers (request_id, driver_id, offered_fare, expires_at) 
                 VALUES (?, ?, ?, ?) 
                 ON DUPLICATE KEY UPDATE offered_fare = ?, expires_at = ?, status = 'sent'`,
                [request_id, driver_id, offered_fare, expires_at, offered_fare, expires_at]
            );

            res.status(201).json({ success: true, message: "Offer sent successfully", offerId: result.insertId });
        } catch (err) {
            console.error("Make Offer Error:", err);
            res.status(500).json({ success: false, message: "Error making offer", error: err.message });
        } finally {
            if (conn) conn.release();
        }
    },

    getOffers: async (req, res) => {
        const { ride_id } = req.params;

        let conn;
        try {
            conn = await pool.getConnection();
            const query = `
                SELECT o.*, d.full_name as driver_name, d.vehicle_type, d.vehicle_model, d.vehicle_number
                FROM driver_fare_offers o
                JOIN drivers d ON o.driver_id = d.id
                WHERE o.request_id = ? AND o.status = 'sent' AND o.expires_at > ?
            `;
            const [offers] = await conn.query(query, [ride_id, new Date()]);

            res.json({ success: true, count: offers.length, data: offers });
        } catch (err) {
            console.error("Get Offers Error:", err);
            res.status(500).json({ success: false, message: "Error fetching offers", error: err.message });
        } finally {
            if (conn) conn.release();
        }
    },

    acceptOffer: async (req, res) => {
        const { offer_id } = req.body;

        if (!offer_id) return res.status(400).json({ success: false, message: "Offer ID is required" });

        let conn;
        try {
            conn = await pool.getConnection();
            await conn.beginTransaction();

            // 1. Get offer details
            const [offers] = await conn.query("SELECT * FROM driver_fare_offers WHERE offer_id = ?", [offer_id]);
            if (offers.length === 0) throw new Error("Offer not found");

            const offer = offers[0];
            if (offer.status !== 'sent') throw new Error("Offer is no longer available");
            if (new Date(offer.expires_at) < new Date()) throw new Error("Offer has expired");

            // 2. Accept this offer
            await conn.query("UPDATE driver_fare_offers SET status = 'accepted' WHERE offer_id = ?", [offer_id]);

            // 3. Reject other offers for the same ride
            await conn.query("UPDATE driver_fare_offers SET status = 'rejected' WHERE request_id = ? AND offer_id != ?", [offer.request_id, offer_id]);

            // 4. Update ride_history
            await conn.query(
                "UPDATE ride_history SET Driver_ID_Fk = ?, Fare = ?, Ride_Status = 'Accepted' WHERE Ride_ID_Pk = ?",
                [offer.driver_id, offer.offered_fare, offer.request_id]
            );

            await conn.commit();
            res.json({ success: true, message: "Offer accepted and driver assigned" });
        } catch (err) {
            if (conn) await conn.rollback();
            console.error("Accept Offer Error:", err);
            res.status(500).json({ success: false, message: err.message });
        } finally {
            if (conn) conn.release();
        }
    }
};

module.exports = rideController;

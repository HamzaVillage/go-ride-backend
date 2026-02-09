const pool = require('../db/Connect_Db');

const getAvailableVehicles = async (conn) => {
    const [rows] = await conn.query("SELECT Vehicle_Type, Base_Fare, Per_Km_Rate, Per_Minute_Rate FROM vehicle_fare_rate WHERE Is_Active = 1");
    return rows;
};

const farecalculationController = {
    calculateFare: async (req, res) => {
        const { vehicle_type, distance, duration, is_peak_hour, is_night, waiting_time = 0 } = req.body || req.query;

        // Validate inputs
        const errors = [];
        if (!vehicle_type) errors.push('Vehicle type is required');
        if (distance === undefined || distance <= 0) errors.push('Distance must be greater than 0');
        if (duration === undefined || duration < 0) errors.push('Duration cannot be negative');
        if (waiting_time < 0) errors.push('Waiting time cannot be negative');

        if (errors.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: errors
            });
        }

        let conn;
        try {
            conn = await pool.getConnection();

            // Get vehicle rate from database
            const [rows] = await conn.query(
                "SELECT * FROM vehicle_fare_rate WHERE Vehicle_Type = ? AND Is_Active = 1",
                [vehicle_type]
            );

            if (rows.length === 0) {
                const available = await getAvailableVehicles(conn);
                return res.status(404).json({
                    success: false,
                    message: 'Vehicle type not found or inactive',
                    available_vehicles: available
                });
            }

            const vehicle_rate = rows[0];

            // Calculate fare components
            const base_fare = parseFloat(vehicle_rate.Base_Fare);
            const per_km_rate = parseFloat(vehicle_rate.Per_Km_Rate);
            const per_minute_rate = parseFloat(vehicle_rate.Per_Minute_Rate);

            // Calculate distance fare (first km included in base fare according to PHP logic)
            const distance_after_first_km = Math.max(0, distance - 1);
            const distance_fare = base_fare + (distance_after_first_km * per_km_rate);

            // Calculate time-based charges
            const time_fare = duration * per_minute_rate;

            // Calculate waiting charges
            const waiting_charges = waiting_time * per_minute_rate;

            // Calculate base total
            const base_total = distance_fare + time_fare + waiting_charges;

            // Calculate surcharges
            let night_charge = 0;
            let peak_hour_surcharge = 0;

            if (is_night === true || is_night === 'true') {
                const night_percent = parseFloat(vehicle_rate.Night_Charge_Percent);
                night_charge = (base_total * night_percent) / 100;
            }

            if (is_peak_hour === true || is_peak_hour === 'true') {
                const peak_percent = parseFloat(vehicle_rate.Peak_Hours_Percent);
                peak_hour_surcharge = (base_total * peak_percent) / 100;
            }

            // Calculate final fare
            let total_fare = base_total + night_charge + peak_hour_surcharge;

            // Round up to nearest 10 for convenience
            total_fare = Math.ceil(total_fare / 10) * 10;

            // Prepare detailed breakdown
            const breakdown = {
                base_fare: {
                    amount: base_fare,
                    description: 'First kilometer charge'
                },
                distance_charge: {
                    amount: distance_after_first_km * per_km_rate,
                    description: `Additional ${distance_after_first_km} km × PKR ${per_km_rate}/km`,
                    rate_per_km: per_km_rate,
                    additional_kms: distance_after_first_km
                },
                time_charge: {
                    amount: time_fare,
                    description: `${duration} minutes × PKR ${per_minute_rate}/min`,
                    rate_per_minute: per_minute_rate,
                    duration_minutes: duration
                },
                waiting_charge: {
                    amount: waiting_charges,
                    description: `${waiting_time} minutes waiting × PKR ${per_minute_rate}/min`,
                    waiting_minutes: waiting_time
                }
            };

            // Add surcharges if applicable
            if (night_charge > 0) {
                breakdown.night_surcharge = {
                    amount: night_charge,
                    description: `Night charge (${vehicle_rate.Night_Charge_Percent}%)`,
                    percentage: `${vehicle_rate.Night_Charge_Percent}%`,
                    applicable: true
                };
            }

            if (peak_hour_surcharge > 0) {
                breakdown.peak_hour_surcharge = {
                    amount: peak_hour_surcharge,
                    description: `Peak hour surcharge (${vehicle_rate.Peak_Hours_Percent}%)`,
                    percentage: `${vehicle_rate.Peak_Hours_Percent}%`,
                    applicable: true
                };
            }

            // Prepare response
            const response = {
                success: true,
                message: 'Fare calculated successfully',
                data: {
                    vehicle_type: vehicle_type,
                    distance: `${parseFloat(distance).toFixed(2)} km`,
                    duration: `${duration} minutes`,
                    waiting_time: `${waiting_time} minutes`,
                    is_peak_hour: is_peak_hour,
                    is_night_ride: is_night,
                    total_fare: {
                        amount: total_fare,
                        currency: vehicle_rate.Currency || 'PKR',
                        formatted: `${vehicle_rate.Currency || 'PKR'} ${total_fare.toLocaleString()}`
                    },
                    fare_breakdown: breakdown,
                    vehicle_rates: {
                        base_fare: vehicle_rate.Base_Fare,
                        per_km_rate: vehicle_rate.Per_Km_Rate,
                        per_minute_rate: vehicle_rate.Per_Minute_Rate,
                        night_charge_percent: vehicle_rate.Night_Charge_Percent,
                        peak_hour_percent: vehicle_rate.Peak_Hours_Percent,
                        minimum_distance: vehicle_rate.Minimum_Distance,
                        maximum_distance: vehicle_rate.Maximum_Distance
                    },
                    karachi_info: {
                        peak_hours: '8:00 AM - 11:00 AM, 5:00 PM - 8:00 PM',
                        night_hours: '10:00 PM - 6:00 AM',
                        currency: 'PKR (Pakistani Rupees)'
                    }
                }
            };

            res.json(response);

        } catch (err) {
            console.error("Fare Calc Error:", err);
            res.status(500).json({
                success: false,
                message: 'Database error',
                error: err.message
            });
        } finally {
            if (conn) conn.release();
        }
    }
};

module.exports = farecalculationController;

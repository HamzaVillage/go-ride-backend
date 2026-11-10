const pool = require('../db/Connect_Db');
const { loadFarePolicy, scheduleStatus, calculateEstimatedFare } = require('../services/farePolicy');

const farecalculationController = {
    calculateFare: async (req, res) => {
        const input = req.method === 'GET' ? req.query : req.body;
        const { vehicle_type } = input || {};
        const distance = Number(input?.distance), duration = Number(input?.duration), waiting_time = Number(input?.waiting_time ?? 0);
        if ((vehicle_type !== undefined && (typeof vehicle_type !== 'string' || vehicle_type.length > 50)) ||
            input?.distance === undefined || input?.duration === undefined ||
            ![distance, duration, waiting_time].every(Number.isFinite) || distance <= 0 || distance > 9999.99 || duration < 0 || duration > 100000 || waiting_time < 0 || waiting_time > 100000 ||
            [input.distance, input.duration, input.waiting_time].some(value => value !== undefined && !['string', 'number'].includes(typeof value))) {
            return res.status(400).json({ success: false, message: 'Enter a valid positive distance and non-negative duration/waiting time.' });
        }

        let conn;
        try {
            conn = await pool.getConnection();

            const [availability] = await conn.query('SELECT ride_service FROM sysconfigsetup WHERE SCS_ID_Pk = 1');
            if (!availability.length || Number(availability[0].ride_service) !== 1) return res.status(503).json({ success: false, message: 'Ride booking is temporarily unavailable.' });
            const policy = await loadFarePolicy(conn);
            const now = new Date();
            // The server schedule is authoritative, including for older mobile clients.
            const { isPeak: is_peak_hour, isNight: is_night } = scheduleStatus(policy, now);
            const [rates] = await conn.query("SELECT * FROM vehicle_fare_rate WHERE Is_Active = 1 ORDER BY Rate_ID_Pk");
            const allRates = rates.filter(rate => distance <= Number(rate.Maximum_Distance ?? 9999.99));

            if (allRates.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'No active vehicles found'
                });
            }

            const estimated_fares = [];
            let requestedVehicleData = null;

            allRates.forEach(rate => {
                const calc = calculateEstimatedFare(rate, distance, duration, is_peak_hour, is_night, waiting_time, policy);

                const fareInfo = {
                    vehicle_type: rate.Vehicle_Type,
                    estimated_price: calc.total_fare,
                    currency: rate.Currency || 'PKR',
                    formatted_price: `${rate.Currency || 'PKR'} ${calc.total_fare.toLocaleString()}`,
                    vehicle_rates: {
                        base_fare: rate.Base_Fare,
                        per_km_rate: rate.Per_Km_Rate,
                        per_minute_rate: rate.Per_Minute_Rate,
                        night_charge_percent: rate.Night_Charge_Percent,
                        peak_hour_percent: rate.Peak_Hours_Percent,
                        fee_percentage: rate.Fee_Percentage
                    }
                };

                estimated_fares.push(fareInfo);

                // If this is the requested vehicle, capture for detailed breakdown
                if (vehicle_type && rate.Vehicle_Type.toLowerCase() === vehicle_type.toLowerCase()) {
                    requestedVehicleData = {
                        rate,
                        calc
                    };
                }
            });

            // If no specific vehicle requested or not found, use the first available for the "primary" slot
            if (!requestedVehicleData && allRates.length > 0) {
                requestedVehicleData = {
                    rate: allRates[0],
                    calc: calculateEstimatedFare(allRates[0], distance, duration, is_peak_hour, is_night, waiting_time, policy)
                };
            }

            // Grouping logic for "cars" (Mini, AC, Premium)
            const carTypes = ['Mini', 'AC', 'Premium'];
            const cars = estimated_fares.filter(f => carTypes.includes(f.vehicle_type));
            const other_vehicles = estimated_fares.filter(f => !carTypes.includes(f.vehicle_type));

            // Prepare breakdown for requested/primary vehicle
            const { rate, calc } = requestedVehicleData;
            const distance_after_first_km = calc.additional_kms;

            const breakdown = {
                base_fare: {
                    amount: calc.base_fare,
                    description: `Base fare includes ${policy.included_km} km`
                },
                distance_charge: {
                    amount: calc.distance_fare,
                    description: `Additional ${distance_after_first_km.toFixed(2)} km × PKR ${rate.Per_Km_Rate}/km`,
                    rate_per_km: rate.Per_Km_Rate,
                    additional_kms: distance_after_first_km
                },
                time_charge: {
                    amount: calc.time_fare,
                    description: `${duration} minutes × PKR ${rate.Per_Minute_Rate}/min`,
                    rate_per_minute: rate.Per_Minute_Rate,
                    duration_minutes: duration
                }
            };

            if (waiting_time > 0) {
                breakdown.waiting_charge = {
                    amount: calc.waiting_charges,
                    description: `${waiting_time} minutes waiting × PKR ${rate.Per_Minute_Rate}/min`,
                    waiting_minutes: waiting_time
                };
            }

            if (calc.night_charge > 0) {
                breakdown.night_surcharge = {
                    amount: calc.night_charge,
                    description: `Night charge (${rate.Night_Charge_Percent}%)`,
                    percentage: `${rate.Night_Charge_Percent}%`
                };
            }

            if (calc.peak_hour_surcharge > 0) {
                breakdown.peak_hour_surcharge = {
                    amount: calc.peak_hour_surcharge,
                    description: `Peak hour surcharge (${rate.Peak_Hours_Percent}%)`,
                    percentage: `${rate.Peak_Hours_Percent}%`
                };
            }

            if (calc.organization_fee > 0) {
                breakdown.organization_fee = {
                    amount: calc.organization_fee,
                    description: `Organization Fee (${rate.Fee_Percentage}%)`,
                    percentage: `${rate.Fee_Percentage}%`
                };
            }

            res.json({
                success: true,
                message: 'Fare calculated successfully',
                data: {
                    primary_calculation: {
                        vehicle_type: rate.Vehicle_Type,
                        distance: `${parseFloat(distance).toFixed(2)} km`,
                        duration: `${duration} minutes`,
                        waiting_time: `${waiting_time} minutes`,
                        is_peak_hour: is_peak_hour === true || is_peak_hour === 'true',
                        is_night_ride: is_night === true || is_night === 'true',
                        total_fare: {
                            amount: calc.total_fare,
                            currency: rate.Currency || 'PKR',
                            formatted: `${rate.Currency || 'PKR'} ${calc.total_fare.toLocaleString()}`
                        },
                        fare_breakdown: breakdown
                    },
                    estimated_fares: other_vehicles,
                    cars: cars,
                    karachi_info: {
                        current_time: now.toLocaleString("en-US", { timeZone: "Asia/Karachi" }),
                        peak_hours: policy.peak_enabled ? policy.peak_windows.map(window => `${window.start} - ${window.end} (${window.days.map(day => ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][day]).join(', ')})`).join('; ') : 'Disabled',
                        night_hours: policy.night_enabled ? `${policy.night_start} - ${policy.night_end}` : 'Disabled',
                        currency: 'PKR (Pakistani Rupees)'
                    }
                }
            });

        } catch (err) {
            console.error("Fare Calc Error:", err.code || 'INTERNAL_ERROR');
            res.status(500).json({
                success: false,
                message: 'Unable to calculate fares right now.'
            });
        } finally {
            if (conn) conn.release();
        }
    },

    getVehicleTypes: async (req, res) => {
        let conn;
        try {
            conn = await pool.getConnection();
            const [rows] = await conn.query("SELECT Vehicle_Type FROM vehicle_fare_rate WHERE Is_Active = 1 ORDER BY Rate_ID_Pk ASC");
            const vehicles = rows.map(r => r.Vehicle_Type);
            res.json({ success: true, vehicles });
        } catch (err) {
            console.error("Get Vehicle Types Error:", err);
            res.status(500).json({ success: false, message: "Error fetching vehicle types", error: err.message });
        } finally {
            if (conn) conn.release();
        }
    }
};

module.exports = farecalculationController;


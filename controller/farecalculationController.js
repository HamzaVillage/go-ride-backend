const pool = require('../db/Connect_Db');

const getKarachiTime = () => {
    return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Karachi" }));
};

const getKarachiAutoStatus = () => {
    const karachiDate = getKarachiTime();
    const hour = karachiDate.getHours();

    // Peak Hour Check: 08:00 - 11:00 and 17:00 - 20:00
    const isPeak = (hour >= 8 && hour < 11) || (hour >= 17 && hour < 20);

    // Night Hour Check: 22:00 - 06:00
    const isNight = (hour >= 22 || hour < 6);

    return { isPeak, isNight };
};

const calculateEstimatedFare = (vehicle_rate, distance, duration, is_peak_hour, is_night, waiting_time = 0) => {
    const base_fare = parseFloat(vehicle_rate.Base_Fare);
    const per_km_rate = parseFloat(vehicle_rate.Per_Km_Rate);
    const per_minute_rate = parseFloat(vehicle_rate.Per_Minute_Rate);

    // Calculate distance fare (first km included in base fare according to logic)
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

    // Add Organization Fee (added TO the rider's total)
    const fee_percent = parseFloat(vehicle_rate.Fee_Percentage || 0);
    const organization_fee = (total_fare * fee_percent) / 100;
    total_fare += organization_fee;

    // Round up to nearest 10
    total_fare = Math.ceil(total_fare / 10) * 10;

    return {
        total_fare,
        base_fare,
        distance_fare: distance_after_first_km * per_km_rate,
        time_fare,
        waiting_charges,
        night_charge,
        peak_hour_surcharge,
        fee_percentage: fee_percent,
        organization_fee: organization_fee
    };
};

const farecalculationController = {
    calculateFare: async (req, res) => {
        let { vehicle_type, distance, duration, is_peak_hour, is_night, waiting_time = 0 } = req.body || req.query;

        // Automatically determine status if not provided
        const autoStatus = getKarachiAutoStatus();
        if (is_peak_hour === undefined || is_peak_hour === null) {
            is_peak_hour = autoStatus.isPeak;
        }
        if (is_night === undefined || is_night === null) {
            is_night = autoStatus.isNight;
        }

        // Validate inputs
        const errors = [];
        // vehicle_type is now optional as we return all, but we can use it to determine the "primary" or "requested" one
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

            // Get all active vehicle rates
            const [allRates] = await conn.query("SELECT * FROM vehicle_fare_rate WHERE Is_Active = 1");

            if (allRates.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'No active vehicles found'
                });
            }

            const estimated_fares = [];
            let requestedVehicleData = null;

            allRates.forEach(rate => {
                const calc = calculateEstimatedFare(rate, distance, duration, is_peak_hour, is_night, waiting_time);

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
                    calc: calculateEstimatedFare(allRates[0], distance, duration, is_peak_hour, is_night, waiting_time)
                };
            }

            // Grouping logic for "cars" (Mini, AC, Premium)
            const carTypes = ['Mini', 'AC', 'Premium'];
            const cars = estimated_fares.filter(f => carTypes.includes(f.vehicle_type));
            const other_vehicles = estimated_fares.filter(f => !carTypes.includes(f.vehicle_type));

            // Prepare breakdown for requested/primary vehicle
            const { rate, calc } = requestedVehicleData;
            const distance_after_first_km = Math.max(0, distance - 1);

            const breakdown = {
                base_fare: {
                    amount: calc.base_fare,
                    description: 'First kilometer charge'
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
                        current_time: getKarachiTime().toLocaleString("en-US", { timeZone: "Asia/Karachi" }),
                        peak_hours: '8:00 AM - 11:00 AM, 5:00 PM - 8:00 PM',
                        night_hours: '10:00 PM - 6:00 AM',
                        currency: 'PKR (Pakistani Rupees)'
                    }
                }
            });

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


-- ONE-TIME upgrade ONLY for databases containing the original 10-table schema.
-- First import the UPDATED add_city_to_city.sql, which creates/seeds the services
-- and fare-rate tables while preserving existing tables and data.
-- Do NOT run this upgrade after a fresh import of the updated 12-table schema.
-- DDL commits implicitly. If interrupted, inspect completed statements before retry.
-- Service IDs are backfilled by stable codes, never by assumed numeric IDs.

ALTER TABLE city_to_city_driver_services ADD COLUMN service_id INT NULL AFTER city_to_city_driver_id;
ALTER TABLE city_to_city_requests
    ADD COLUMN service_id INT NULL AFTER customer_user_id,
    ADD COLUMN requested_vehicle_type VARCHAR(40) NULL AFTER passenger_count,
    ADD COLUMN estimated_distance_km DECIMAL(10,2) NULL AFTER requested_vehicle_type,
    ADD COLUMN estimated_duration_minutes INT UNSIGNED NULL AFTER estimated_distance_km,
    ADD COLUMN fare_rate_id INT NULL AFTER estimated_duration_minutes,
    ADD COLUMN fare_snapshot LONGTEXT NULL COMMENT 'Server-generated JSON of tariff, inputs and calculation version; never client supplied' AFTER fare_rate_id,
    ADD COLUMN quote_expires_at DATETIME NULL AFTER fare_snapshot;
ALTER TABLE city_to_city_trips ADD COLUMN service_id INT NULL AFTER vehicle_id;
ALTER TABLE city_to_city_bookings
    ADD COLUMN fare_snapshot LONGTEXT NULL COMMENT 'Immutable accepted tariff, breakdown and cancellation policy, including service/rate IDs' AFTER accepted_offer_id;

UPDATE city_to_city_driver_services d
JOIN city_to_city_services s ON s.code = d.service_type
SET d.service_id = s.id WHERE d.service_id IS NULL;
UPDATE city_to_city_requests r
JOIN city_to_city_services s ON s.code = r.service_type
SET r.service_id = s.id WHERE r.service_id IS NULL;
UPDATE city_to_city_trips t
JOIN city_to_city_services s ON s.code = t.trip_type
SET t.service_id = s.id WHERE t.service_id IS NULL;

ALTER TABLE city_to_city_driver_services
    MODIFY COLUMN service_id INT NOT NULL,
    DROP INDEX uq_c2c_driver_service,
    ADD UNIQUE KEY uq_c2c_driver_service (city_to_city_driver_id, service_id),
    ADD CONSTRAINT fk_c2c_driver_master_service FOREIGN KEY (service_id, service_type) REFERENCES city_to_city_services(id, code);
ALTER TABLE city_to_city_requests
    MODIFY COLUMN service_id INT NOT NULL,
    ADD CONSTRAINT fk_c2c_request_master_service FOREIGN KEY (service_id, service_type) REFERENCES city_to_city_services(id, code),
    ADD CONSTRAINT fk_c2c_request_rate FOREIGN KEY (fare_rate_id, service_id) REFERENCES city_to_city_fare_rates(id, service_id),
    ADD CONSTRAINT chk_c2c_request_snapshot CHECK (fare_snapshot IS NULL OR JSON_VALID(fare_snapshot)),
    ADD CONSTRAINT chk_c2c_request_distance CHECK (estimated_distance_km IS NULL OR estimated_distance_km >= 0);
ALTER TABLE city_to_city_trips
    MODIFY COLUMN service_id INT NOT NULL,
    ADD CONSTRAINT fk_c2c_trip_master_service FOREIGN KEY (service_id, trip_type) REFERENCES city_to_city_services(id, code);
ALTER TABLE city_to_city_bookings
    ADD CONSTRAINT chk_c2c_booking_snapshot CHECK (fare_snapshot IS NULL OR JSON_VALID(fare_snapshot));

-- Historical fare snapshots remain NULL; existing accepted prices are preserved.
-- Configure actual rates, then enable is_pricing_enabled on each service.
SELECT id, code, name, is_active, is_pricing_enabled FROM city_to_city_services ORDER BY sort_order;

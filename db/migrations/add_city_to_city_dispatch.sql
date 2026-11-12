-- City membership is based on reverse-geocoded current coordinates, never home_city or radius.
ALTER TABLE city_to_city_drivers
 ADD COLUMN IF NOT EXISTS current_city_id INT NULL,
 ADD COLUMN IF NOT EXISTS presence_updated_at DATETIME NULL;
-- Separate lightweight dispatch assignment links existing requests/trips/bookings.
CREATE TABLE IF NOT EXISTS city_to_city_dispatch (
 request_id INT NOT NULL PRIMARY KEY,
 city_to_city_driver_id INT NOT NULL,
 trip_id INT NOT NULL,
 booking_id INT NOT NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT fk_dispatch_request FOREIGN KEY (request_id) REFERENCES city_to_city_requests(id),
 CONSTRAINT fk_dispatch_driver FOREIGN KEY (city_to_city_driver_id) REFERENCES city_to_city_drivers(id),
 CONSTRAINT fk_dispatch_trip FOREIGN KEY (trip_id) REFERENCES city_to_city_trips(id),
 CONSTRAINT fk_dispatch_booking FOREIGN KEY (booking_id) REFERENCES city_to_city_bookings(id)
) ENGINE=InnoDB;

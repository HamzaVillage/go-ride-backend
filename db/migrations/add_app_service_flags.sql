-- MariaDB 10.5: run against the GoRide database before deploying service switches.
-- Preserve existing switches; newly introduced services start as Coming soon.
ALTER TABLE sysconfigsetup
    ADD COLUMN IF NOT EXISTS city_to_city_service TINYINT(1) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS hotel_booking_service TINYINT(1) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS car_rental_service TINYINT(1) NOT NULL DEFAULT 0;

SELECT SCS_ID_Pk, ride_service, city_to_city_service, courier_service,
       food_delivery_service, grocery_service, hotel_booking_service, car_rental_service
FROM sysconfigsetup WHERE SCS_ID_Pk = 1;

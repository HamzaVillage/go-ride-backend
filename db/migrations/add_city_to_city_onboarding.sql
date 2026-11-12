-- Run after add_city_to_city.sql (and its dynamic-services upgrade, if needed).
-- MariaDB 10.5, additive and safe to rerun; does not change city driver tables.
ALTER TABLE city_to_city_drivers
    ADD COLUMN IF NOT EXISTS full_name VARCHAR(100) NULL,
    ADD COLUMN IF NOT EXISTS father_name VARCHAR(100) NULL,
    ADD COLUMN IF NOT EXISTS cnic VARCHAR(15) NULL,
    ADD COLUMN IF NOT EXISTS dob DATE NULL,
    ADD COLUMN IF NOT EXISTS address TEXT NULL,
    ADD COLUMN IF NOT EXISTS easypaisa VARCHAR(15) NULL,
    ADD COLUMN IF NOT EXISTS jazzcash VARCHAR(15) NULL;

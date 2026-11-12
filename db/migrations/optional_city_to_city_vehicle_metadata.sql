-- Make/year are not collected during the existing driver signup. Preserve known values.
ALTER TABLE city_to_city_vehicles
    MODIFY COLUMN make VARCHAR(60) NULL,
    MODIFY COLUMN manufacture_year SMALLINT UNSIGNED NULL;

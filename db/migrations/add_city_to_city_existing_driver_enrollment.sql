-- MariaDB 10.5. Run after the city-to-city foundation/onboarding migrations.
-- Imported applications may be incomplete while pending; approval still requires
-- a city, complete vehicle metadata and all identity/vehicle documents.
ALTER TABLE city_to_city_drivers
    MODIFY COLUMN home_city_id INT NULL,
    ADD COLUMN IF NOT EXISTS source_driver_id INT NULL REFERENCES drivers(id),
    ADD COLUMN IF NOT EXISTS enrollment_source ENUM('new','city_driver') NOT NULL DEFAULT 'new',
    ADD COLUMN IF NOT EXISTS source_snapshot LONGTEXT NULL;
ALTER TABLE city_to_city_driver_documents
    ADD COLUMN IF NOT EXISTS source_driver_id INT NULL REFERENCES drivers(id),
    ADD COLUMN IF NOT EXISTS source_document_key VARCHAR(60) NULL;

-- Apply once before enabling direct admin driver registration. No existing records are changed.
CREATE TABLE IF NOT EXISTS admin_driver_registration_requests (
 request_key CHAR(36) NOT NULL PRIMARY KEY,
 actor_id INT NOT NULL,
 fingerprint CHAR(64) NOT NULL,
 driver_kind ENUM('normal','city_to_city') NOT NULL,
 driver_id INT NOT NULL,
 user_id INT NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

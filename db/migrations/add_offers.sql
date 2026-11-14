-- Normal ride promotions. Stored times are epoch milliseconds (UTC).
CREATE TABLE IF NOT EXISTS promotions (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 request_key CHAR(36) NOT NULL UNIQUE,
 name VARCHAR(100) NOT NULL,
 audience ENUM('rider','driver') NOT NULL,
 eligibility ENUM('next_rides','first_rides') NOT NULL,
 discount_percent DECIMAL(5,2) NOT NULL,
 max_discount DECIMAL(10,2) NULL,
 ride_limit INT UNSIGNED NOT NULL,
 starts_at_ms BIGINT NOT NULL,
 ends_at_ms BIGINT NOT NULL,
 status ENUM('active','paused','closed') NOT NULL DEFAULT 'paused',
 version INT UNSIGNED NOT NULL DEFAULT 1,
 created_by BIGINT UNSIGNED NOT NULL,
 updated_by BIGINT UNSIGNED NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 KEY ix_promotion_active (audience,status,starts_at_ms,ends_at_ms)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS ride_promotions (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 ride_id INT NOT NULL,
 offer_id BIGINT UNSIGNED NOT NULL,
 audience ENUM('rider','driver') NOT NULL,
 actor_user_id INT NOT NULL,
 offer_name VARCHAR(100) NOT NULL,
 discount_percent DECIMAL(5,2) NOT NULL,
 max_discount DECIMAL(10,2) NULL,
 discount_base_limit DECIMAL(10,2) NOT NULL,
 original_fare DECIMAL(10,2) NOT NULL,
 benefit_amount DECIMAL(10,2) NOT NULL,
 state ENUM('reserved','consumed','released') NOT NULL DEFAULT 'reserved',
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY uq_ride_promotion (ride_id,audience),
 KEY ix_offer_actor_usage (offer_id,actor_user_id,state),
 CONSTRAINT fk_redemption_offer FOREIGN KEY (offer_id) REFERENCES promotions(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS promotion_audit (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 offer_id BIGINT UNSIGNED NOT NULL,
 actor_id BIGINT UNSIGNED NOT NULL,
 before_json JSON NULL,
 after_json JSON NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 KEY ix_promotion_audit (offer_id,id)
) ENGINE=InnoDB;
INSERT INTO employee_function (function_code,function_name) VALUES ('offers','Offers')
ON DUPLICATE KEY UPDATE function_code=VALUES(function_code);

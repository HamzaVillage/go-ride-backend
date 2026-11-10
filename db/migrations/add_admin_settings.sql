-- Editable operational settings and pricing schedules. Existing fare/service rows are preserved.
CREATE TABLE IF NOT EXISTS fare_policy (
    id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
    policy_json JSON NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by INT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by INT NULL,
    CONSTRAINT fk_fare_policy_creator FOREIGN KEY (created_by) REFERENCES users(User_ID_Pk),
    CONSTRAINT fk_fare_policy_updater FOREIGN KEY (updated_by) REFERENCES users(User_ID_Pk)
) ENGINE=InnoDB;
INSERT INTO fare_policy (id, policy_json) VALUES (1, '{"peak_enabled":true,"peak_windows":[{"start":"08:00","end":"11:00","days":[0,1,2,3,4,5,6]},{"start":"17:00","end":"20:00","days":[0,1,2,3,4,5,6]}],"night_enabled":true,"night_start":"22:00","night_end":"06:00","included_km":1,"round_to":10}')
ON DUPLICATE KEY UPDATE id = VALUES(id);
CREATE TABLE IF NOT EXISTS admin_setting_audit (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by INT NOT NULL,
    before_json JSON NOT NULL,
    after_json JSON NOT NULL,
    KEY ix_settings_audit_time (created_at, id),
    CONSTRAINT fk_settings_audit_actor FOREIGN KEY (created_by) REFERENCES users(User_ID_Pk)
) ENGINE=InnoDB;

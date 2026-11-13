-- Personal account identity and approval stay unchanged. NULL uses legacy-profile fallback.
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_mode
 ENUM('rider','driver','city_to_city_driver') NULL DEFAULT NULL;

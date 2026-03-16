-- Add share_token column for public ride tracking links
ALTER TABLE `ride_history`
  ADD COLUMN `share_token` VARCHAR(64) DEFAULT NULL AFTER `UpdatedAt`,
  ADD UNIQUE KEY `idx_share_token` (`share_token`);

-- Add FCM token columns for push notifications
-- Run this against your existing database if you get "Unknown column 'fcm_token'" errors.

ALTER TABLE `users`
  ADD COLUMN `fcm_token` VARCHAR(512) DEFAULT NULL COMMENT 'Firebase Cloud Messaging token for push notifications',
  ADD COLUMN `fcm_token_updated_at` TIMESTAMP NULL DEFAULT NULL ON UPDATE current_timestamp();

ALTER TABLE `drivers`
  ADD COLUMN `fcm_token` VARCHAR(512) DEFAULT NULL COMMENT 'Firebase Cloud Messaging token for push notifications',
  ADD COLUMN `fcm_token_updated_at` TIMESTAMP NULL DEFAULT NULL ON UPDATE current_timestamp();

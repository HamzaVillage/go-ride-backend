-- Add overdue_since to drivers: when limit is met, set this timestamp.
-- If overdue_since + 8 hours < NOW(), driver is blocked from finding rides.
ALTER TABLE `drivers`
  ADD COLUMN `overdue_since` DATETIME DEFAULT NULL COMMENT 'When driver first met limit; NULL = not overdue';

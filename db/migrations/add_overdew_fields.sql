-- Add rides_limit and rides_over_limit_count to vehicle_fare_rate and drivers
-- rides_limit = threshold (e.g. max rides); rides_over_limit_count = count of rides over that limit
-- Run on your database: mysql -u user -p database < add_overdew_fields.sql

-- 1) vehicle_fare_rate
ALTER TABLE `vehicle_fare_rate`
  ADD COLUMN `rides_limit` int(11) NOT NULL DEFAULT 0 COMMENT 'Rides limit threshold (e.g. max rides per period)',
  ADD COLUMN `rides_over_limit_count` int(11) NOT NULL DEFAULT 0 COMMENT 'Count of rides over the limit';

-- 2) drivers
ALTER TABLE `drivers`
  ADD COLUMN `rides_limit` int(11) NOT NULL DEFAULT 0 COMMENT 'Rides limit threshold (from vehicle_fare_rate)',
  ADD COLUMN `rides_over_limit_count` int(11) NOT NULL DEFAULT 0 COMMENT 'Count of rides over the limit';

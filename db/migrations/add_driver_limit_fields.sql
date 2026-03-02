-- Add rides_limit and rides_over_limit_count to drivers (if missing)
-- Run if you get: Unknown column 'rides_over_limit_count' in 'field list'

ALTER TABLE `drivers`
  ADD COLUMN `rides_limit` int(11) NOT NULL DEFAULT 0 COMMENT 'Rides limit threshold (from vehicle_fare_rate)',
  ADD COLUMN `rides_over_limit_count` int(11) NOT NULL DEFAULT 0 COMMENT 'Count of rides over the limit';

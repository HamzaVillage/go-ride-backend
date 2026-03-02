-- Drivers: keep only driver-owned data. Limits come from vehicle_fare_rate (JOIN when needed).
--
-- RENAME (driver data from driver_earnings):
--   rides_overdue_limit       -> driver_earnings_sum   (SUM(Driver_Earning))
--   rides_count_overdue_limit -> completed_rides_count (COUNT(*))
--
-- DROP (duplicates of vehicle_fare_rate; use INNER JOIN vehicle_fare_rate instead):
--   rides_limit
--   rides_over_limit_count

ALTER TABLE `drivers`
  CHANGE COLUMN `rides_overdue_limit` `driver_earnings_sum` decimal(10,2) NOT NULL DEFAULT 0.00 COMMENT 'SUM(Driver_Earning) from driver_earnings',
  CHANGE COLUMN `rides_count_overdue_limit` `completed_rides_count` int(11) NOT NULL DEFAULT 0 COMMENT 'COUNT(*) from driver_earnings',
  DROP COLUMN `rides_limit`,
  DROP COLUMN `rides_over_limit_count`;

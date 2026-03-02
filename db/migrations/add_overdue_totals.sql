-- Add total earnings & total ride count fields on drivers
-- rides_overdue_limit        = total driver earnings (sum of Driver_Earning)
-- rides_count_overdue_limit  = total completed rides

ALTER TABLE `drivers`
  ADD COLUMN `rides_overdue_limit` decimal(10,2) NOT NULL DEFAULT 0.00 COMMENT 'Total driver earnings to date',
  ADD COLUMN `rides_count_overdue_limit` int(11) NOT NULL DEFAULT 0 COMMENT 'Total completed ride count';


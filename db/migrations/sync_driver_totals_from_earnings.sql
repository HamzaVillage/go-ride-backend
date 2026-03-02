-- Sync driver totals from driver_earnings (single source of truth)
-- Run if drivers table has inconsistent completed_rides_count / driver_earnings_sum

UPDATE drivers d
LEFT JOIN (
  SELECT Driver_ID_Fk, COUNT(*) as cnt, COALESCE(SUM(Driver_Earning), 0) as total
  FROM driver_earnings
  GROUP BY Driver_ID_Fk
) e ON e.Driver_ID_Fk = d.id
SET
  d.completed_rides_count = COALESCE(e.cnt, 0),
  d.driver_earnings_sum = COALESCE(e.total, 0);

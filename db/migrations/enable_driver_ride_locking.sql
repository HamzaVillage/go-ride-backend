-- Apply before deploying concurrent ride acceptance protection.
-- Schedule during a maintenance window: engine conversion can lock the table.
-- Take a backup and check existing active assignments first.
SELECT Driver_ID_Fk, COUNT(*) AS active_rides
FROM ride_history
WHERE Driver_ID_Fk IS NOT NULL
  AND Ride_Status IN ('Accepted', 'Arrived', 'Started', 'Ongoing')
GROUP BY Driver_ID_Fk
HAVING COUNT(*) > 1;

ALTER TABLE drivers ENGINE = InnoDB;
ALTER TABLE ride_history ENGINE = InnoDB;

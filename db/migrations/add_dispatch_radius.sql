-- Run once before deploying database-configured dispatch.
ALTER TABLE sysconfigsetup
    ADD COLUMN dispatch_radius_km DECIMAL(6,2) NOT NULL DEFAULT 5.00
    COMMENT 'Pickup search radius in kilometers';

-- Change the value on configuration row 1 to control the search radius.
-- Example: UPDATE sysconfigsetup SET dispatch_radius_km = 8.00 WHERE SCS_ID_Pk = 1;
SELECT SCS_ID_Pk, dispatch_radius_km FROM sysconfigsetup WHERE SCS_ID_Pk = 1;

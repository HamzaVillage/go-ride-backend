-- Run once after add_dispatch_radius.sql, before deploying staged search.
ALTER TABLE sysconfigsetup
    ADD COLUMN dispatch_min_radius_km DECIMAL(6,2) NOT NULL DEFAULT 1.00
    COMMENT 'Initial pickup search radius in kilometers';

-- Keep the new minimum inside an existing maximum smaller than 1 km.
UPDATE sysconfigsetup SET dispatch_min_radius_km = dispatch_radius_km
WHERE dispatch_radius_km > 0 AND dispatch_radius_km < dispatch_min_radius_km;

-- Example: UPDATE sysconfigsetup SET dispatch_min_radius_km = 1, dispatch_radius_km = 5 WHERE SCS_ID_Pk = 1;
SELECT SCS_ID_Pk, dispatch_min_radius_km, dispatch_radius_km FROM sysconfigsetup WHERE SCS_ID_Pk = 1;

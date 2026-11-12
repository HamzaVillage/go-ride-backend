-- City-to-city foundation. Compatible with the repository's MariaDB 10.5 schema.
-- Select the GoRide database before executing this file.
-- Prerequisites: users(User_ID_Pk INT), city(ID_PK INT), both indexed/InnoDB.
-- All new date/time values must be written in UTC by the application.
-- CREATE IF NOT EXISTS permits reruns; it does not upgrade pre-existing tables.
-- DDL commits implicitly: this script is not an atomic migration.
-- If the previous 10-table version was imported, import this file FIRST to add
-- the master/rate tables, THEN run upgrade_city_to_city_dynamic_services.sql once.
-- Existing tables are skipped by CREATE IF NOT EXISTS; the upgrade links them.

CREATE TABLE IF NOT EXISTS city_to_city_services (
    id INT NOT NULL AUTO_INCREMENT,
    code ENUM('shared','private','parcel') NOT NULL COMMENT 'Stable backend behaviour; do not rename after bookings exist',
    name VARCHAR(100) NOT NULL,
    name_ur VARCHAR(150) NULL,
    description TEXT NULL,
    description_ur TEXT NULL,
    icon_url VARCHAR(512) NULL,
    image_url VARCHAR(512) NULL,
    requires_passenger_count TINYINT(1) NOT NULL,
    requires_parcel_details TINYINT(1) NOT NULL,
    pricing_unit ENUM('per_seat','whole_car','per_delivery') NOT NULL,
    min_passengers SMALLINT UNSIGNED NULL,
    max_passengers SMALLINT UNSIGNED NULL,
    max_parcel_weight_kg DECIMAL(8,2) NULL,
    max_parcel_length_cm DECIMAL(8,2) NULL,
    max_parcel_width_cm DECIMAL(8,2) NULL,
    max_parcel_height_cm DECIMAL(8,2) NULL,
    max_declared_value DECIMAL(12,2) NULL,
    allows_fragile TINYINT(1) NOT NULL DEFAULT 0,
    allows_now TINYINT(1) NOT NULL DEFAULT 1,
    allows_scheduled TINYINT(1) NOT NULL DEFAULT 1,
    minimum_notice_minutes INT UNSIGNED NOT NULL DEFAULT 0,
    maximum_advance_days SMALLINT UNSIGNED NOT NULL DEFAULT 30,
    request_expiry_minutes INT UNSIGNED NOT NULL DEFAULT 30,
    offer_expiry_minutes INT UNSIGNED NOT NULL DEFAULT 10,
    seat_hold_minutes INT UNSIGNED NOT NULL DEFAULT 5,

    -- Default tariff. Amounts are in currency, per pricing_unit unless noted.
    currency CHAR(3) NOT NULL DEFAULT 'PKR',
    fare_model ENUM('distance','fixed') NOT NULL DEFAULT 'distance',
    base_fare DECIMAL(12,2) NOT NULL DEFAULT 0,
    per_km_rate DECIMAL(12,2) NOT NULL DEFAULT 0,
    per_minute_rate DECIMAL(12,2) NOT NULL DEFAULT 0,
    minimum_fare DECIMAL(12,2) NOT NULL DEFAULT 0,
    maximum_fare DECIMAL(12,2) NULL,
    fixed_fare DECIMAL(12,2) NULL,
    included_distance_km DECIMAL(10,2) NOT NULL DEFAULT 0,
    included_duration_minutes INT UNSIGNED NOT NULL DEFAULT 0,
    included_weight_kg DECIMAL(8,2) NOT NULL DEFAULT 0,
    extra_per_kg_rate DECIMAL(12,2) NOT NULL DEFAULT 0,
    fragile_surcharge DECIMAL(12,2) NOT NULL DEFAULT 0,
    volumetric_divisor_cm3_per_kg DECIMAL(10,2) NULL COMMENT 'NULL uses actual weight; otherwise max(actual, L*W*H/divisor)',
    booking_fee DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT 'Once per booking, after shared seat multiplication',
    waiting_free_minutes INT UNSIGNED NOT NULL DEFAULT 0,
    waiting_per_minute_rate DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT 'Once per booking',
    cancellation_free_minutes INT UNSIGNED NOT NULL DEFAULT 0,
    cancellation_fee DECIMAL(12,2) NOT NULL DEFAULT 0,
    no_show_fee DECIMAL(12,2) NOT NULL DEFAULT 0,
    toll_policy ENUM('included','extra_actual') NOT NULL DEFAULT 'included',
    tax_percent DECIMAL(5,2) NOT NULL DEFAULT 0,
    commission_percent DECIMAL(5,2) NOT NULL DEFAULT 0,
    commission_fixed DECIMAL(12,2) NOT NULL DEFAULT 0,
    allows_negotiation TINYINT(1) NOT NULL DEFAULT 0,
    max_discount_percent DECIMAL(5,2) NOT NULL DEFAULT 0 COMMENT 'Maximum negotiated decrease from recommended unit fare',
    max_markup_percent DECIMAL(5,2) NOT NULL DEFAULT 0 COMMENT 'Maximum negotiated increase from recommended unit fare',
    rounding_increment DECIMAL(8,2) NOT NULL DEFAULT 1 COMMENT 'Round recommended unit fare to nearest increment',
    is_pricing_enabled TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Enable only after configuring real rates',
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    created_by BIGINT UNSIGNED NULL,
    updated_by BIGINT UNSIGNED NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_c2c_service_code (code),
    UNIQUE KEY uq_c2c_service_identity (id, code),
    KEY idx_c2c_services_display (is_active, sort_order),
    CONSTRAINT fk_c2c_master_creator FOREIGN KEY (created_by) REFERENCES employee(emp_id),
    CONSTRAINT fk_c2c_master_editor FOREIGN KEY (updated_by) REFERENCES employee(emp_id),
    CONSTRAINT chk_c2c_master_behaviour CHECK (
        (code = 'shared' AND pricing_unit = 'per_seat' AND requires_passenger_count = 1 AND requires_parcel_details = 0) OR
        (code = 'private' AND pricing_unit = 'whole_car' AND requires_passenger_count = 1 AND requires_parcel_details = 0) OR
        (code = 'parcel' AND pricing_unit = 'per_delivery' AND requires_passenger_count = 0 AND requires_parcel_details = 1)
    ),
    CONSTRAINT chk_c2c_master_passengers CHECK (
        (code = 'parcel' AND min_passengers IS NULL AND max_passengers IS NULL) OR
        (code IN ('shared','private') AND min_passengers IS NOT NULL AND min_passengers > 0 AND
            (max_passengers IS NULL OR max_passengers >= min_passengers))
    ),
    CONSTRAINT chk_c2c_master_limits CHECK (
        (max_parcel_weight_kg IS NULL OR max_parcel_weight_kg > 0) AND
        (max_parcel_length_cm IS NULL OR max_parcel_length_cm > 0) AND
        (max_parcel_width_cm IS NULL OR max_parcel_width_cm > 0) AND
        (max_parcel_height_cm IS NULL OR max_parcel_height_cm > 0) AND
        (max_declared_value IS NULL OR max_declared_value >= 0)
    ),
    CONSTRAINT chk_c2c_master_flags CHECK (
        allows_fragile IN (0,1) AND allows_now IN (0,1) AND allows_scheduled IN (0,1) AND
        allows_negotiation IN (0,1) AND is_pricing_enabled IN (0,1) AND is_active IN (0,1)
    ),
    CONSTRAINT chk_c2c_master_expiry CHECK (request_expiry_minutes > 0 AND offer_expiry_minutes > 0 AND seat_hold_minutes > 0),
    CONSTRAINT chk_c2c_master_amounts CHECK (
        base_fare >= 0 AND per_km_rate >= 0 AND per_minute_rate >= 0 AND minimum_fare >= 0 AND
        included_distance_km >= 0 AND included_weight_kg >= 0 AND extra_per_kg_rate >= 0 AND
        fragile_surcharge >= 0 AND booking_fee >= 0 AND waiting_per_minute_rate >= 0 AND
        cancellation_fee >= 0 AND no_show_fee >= 0 AND commission_fixed >= 0 AND rounding_increment > 0 AND
        (maximum_fare IS NULL OR maximum_fare >= minimum_fare) AND (fixed_fare IS NULL OR fixed_fare >= 0) AND
        (volumetric_divisor_cm3_per_kg IS NULL OR volumetric_divisor_cm3_per_kg > 0)
    ),
    CONSTRAINT chk_c2c_master_percentages CHECK (
        tax_percent BETWEEN 0 AND 100 AND commission_percent BETWEEN 0 AND 100 AND
        max_discount_percent BETWEEN 0 AND 100 AND max_markup_percent BETWEEN 0 AND 100
    ),
    CONSTRAINT chk_c2c_master_fixed CHECK (fare_model <> 'fixed' OR fixed_fare IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- No invented production fares: services are visible, pricing remains disabled.
-- Rerunning this seed preserves all admin-edited settings.
INSERT INTO city_to_city_services
    (code, name, description, requires_passenger_count, requires_parcel_details, pricing_unit, min_passengers, sort_order)
SELECT 'shared', 'Share your ride', 'Book passenger seats in a shared car', 1, 0, 'per_seat', 1, 1
WHERE NOT EXISTS (SELECT 1 FROM city_to_city_services WHERE code = 'shared');
INSERT INTO city_to_city_services
    (code, name, description, requires_passenger_count, requires_parcel_details, pricing_unit, min_passengers, sort_order)
SELECT 'parcel', 'Send a parcel', 'Send a parcel between cities', 0, 1, 'per_delivery', NULL, 2
WHERE NOT EXISTS (SELECT 1 FROM city_to_city_services WHERE code = 'parcel');
INSERT INTO city_to_city_services
    (code, name, description, requires_passenger_count, requires_parcel_details, pricing_unit, min_passengers, sort_order)
SELECT 'private', 'Request a car', 'Reserve the whole passenger cabin', 1, 0, 'whole_car', 1, 3
WHERE NOT EXISTS (SELECT 1 FROM city_to_city_services WHERE code = 'private');

-- A matching row is a COMPLETE tariff, not a set of nullable overrides.
-- Directional routes: Karachi -> Hyderabad does not imply Hyderabad -> Karachi.
-- Lookup at requested departure: active service + active pricing, exact vehicle_type
-- first, then NULL (all vehicles), then service defaults. Within a scope use
-- priority DESC, valid_from DESC, id DESC. valid_until is exclusive.
CREATE TABLE IF NOT EXISTS city_to_city_fare_rates (
    id INT NOT NULL AUTO_INCREMENT,
    service_id INT NOT NULL,
    origin_city_id INT NOT NULL,
    destination_city_id INT NOT NULL,
    vehicle_type VARCHAR(40) NULL COMMENT 'NULL applies to any vehicle type; normalize category codes in API',
    name VARCHAR(150) NOT NULL,
    currency CHAR(3) NOT NULL DEFAULT 'PKR',
    fare_model ENUM('distance','fixed') NOT NULL DEFAULT 'distance',
    base_fare DECIMAL(12,2) NOT NULL DEFAULT 0,
    per_km_rate DECIMAL(12,2) NOT NULL DEFAULT 0,
    per_minute_rate DECIMAL(12,2) NOT NULL DEFAULT 0,
    minimum_fare DECIMAL(12,2) NOT NULL DEFAULT 0,
    maximum_fare DECIMAL(12,2) NULL,
    fixed_fare DECIMAL(12,2) NULL,
    included_distance_km DECIMAL(10,2) NOT NULL DEFAULT 0,
    included_duration_minutes INT UNSIGNED NOT NULL DEFAULT 0,
    included_weight_kg DECIMAL(8,2) NOT NULL DEFAULT 0,
    extra_per_kg_rate DECIMAL(12,2) NOT NULL DEFAULT 0,
    fragile_surcharge DECIMAL(12,2) NOT NULL DEFAULT 0,
    volumetric_divisor_cm3_per_kg DECIMAL(10,2) NULL,
    booking_fee DECIMAL(12,2) NOT NULL DEFAULT 0,
    waiting_free_minutes INT UNSIGNED NOT NULL DEFAULT 0,
    waiting_per_minute_rate DECIMAL(12,2) NOT NULL DEFAULT 0,
    cancellation_free_minutes INT UNSIGNED NOT NULL DEFAULT 0,
    cancellation_fee DECIMAL(12,2) NOT NULL DEFAULT 0,
    no_show_fee DECIMAL(12,2) NOT NULL DEFAULT 0,
    toll_policy ENUM('included','extra_actual') NOT NULL DEFAULT 'included',
    tax_percent DECIMAL(5,2) NOT NULL DEFAULT 0,
    commission_percent DECIMAL(5,2) NOT NULL DEFAULT 0,
    commission_fixed DECIMAL(12,2) NOT NULL DEFAULT 0,
    allows_negotiation TINYINT(1) NOT NULL DEFAULT 0,
    max_discount_percent DECIMAL(5,2) NOT NULL DEFAULT 0,
    max_markup_percent DECIMAL(5,2) NOT NULL DEFAULT 0,
    rounding_increment DECIMAL(8,2) NOT NULL DEFAULT 1,
    valid_from DATETIME NOT NULL,
    valid_until DATETIME NULL,
    priority SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    is_pricing_enabled TINYINT(1) NOT NULL DEFAULT 0,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_by BIGINT UNSIGNED NULL,
    updated_by BIGINT UNSIGNED NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_c2c_rate_service (id, service_id),
    KEY idx_c2c_rate_lookup (service_id, origin_city_id, destination_city_id, is_active, vehicle_type, valid_from),
    CONSTRAINT fk_c2c_rate_service FOREIGN KEY (service_id) REFERENCES city_to_city_services(id),
    CONSTRAINT fk_c2c_rate_origin FOREIGN KEY (origin_city_id) REFERENCES city(ID_PK),
    CONSTRAINT fk_c2c_rate_destination FOREIGN KEY (destination_city_id) REFERENCES city(ID_PK),
    CONSTRAINT fk_c2c_rate_creator FOREIGN KEY (created_by) REFERENCES employee(emp_id),
    CONSTRAINT fk_c2c_rate_editor FOREIGN KEY (updated_by) REFERENCES employee(emp_id),
    CONSTRAINT chk_c2c_rate_cities CHECK (origin_city_id <> destination_city_id),
    CONSTRAINT chk_c2c_rate_dates CHECK (valid_until IS NULL OR valid_until > valid_from),
    CONSTRAINT chk_c2c_rate_flags CHECK (is_active IN (0,1) AND is_pricing_enabled IN (0,1) AND allows_negotiation IN (0,1)),
    CONSTRAINT chk_c2c_rate_amounts CHECK (
        base_fare >= 0 AND per_km_rate >= 0 AND per_minute_rate >= 0 AND minimum_fare >= 0 AND
        included_distance_km >= 0 AND included_weight_kg >= 0 AND extra_per_kg_rate >= 0 AND
        fragile_surcharge >= 0 AND booking_fee >= 0 AND waiting_per_minute_rate >= 0 AND
        cancellation_fee >= 0 AND no_show_fee >= 0 AND commission_fixed >= 0 AND rounding_increment > 0 AND
        (maximum_fare IS NULL OR maximum_fare >= minimum_fare) AND (fixed_fare IS NULL OR fixed_fare >= 0) AND
        (volumetric_divisor_cm3_per_kg IS NULL OR volumetric_divisor_cm3_per_kg > 0)
    ),
    CONSTRAINT chk_c2c_rate_percentages CHECK (
        tax_percent BETWEEN 0 AND 100 AND commission_percent BETWEEN 0 AND 100 AND
        max_discount_percent BETWEEN 0 AND 100 AND max_markup_percent BETWEEN 0 AND 100
    ),
    CONSTRAINT chk_c2c_rate_fixed CHECK (fare_model <> 'fixed' OR fixed_fare IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS city_to_city_drivers (
    id INT NOT NULL AUTO_INCREMENT,
    user_id INT NOT NULL,
    driver_code VARCHAR(30) NOT NULL,
    home_city_id INT NULL,
    source_driver_id INT NULL REFERENCES drivers(id),
    enrollment_source ENUM('new','city_driver') NOT NULL DEFAULT 'new',
    source_snapshot LONGTEXT NULL,
    full_name VARCHAR(100) NULL,
    father_name VARCHAR(100) NULL,
    cnic VARCHAR(15) NULL,
    dob DATE NULL,
    address TEXT NULL,
    easypaisa VARCHAR(15) NULL,
    jazzcash VARCHAR(15) NULL,
    application_status ENUM('draft','pending','approved','rejected','suspended') NOT NULL DEFAULT 'draft',
    rejection_reason TEXT NULL,
    approved_by BIGINT UNSIGNED NULL,
    approved_at DATETIME NULL,
    is_online TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_c2c_driver_user (user_id),
    UNIQUE KEY uq_c2c_driver_code (driver_code),
    KEY idx_c2c_driver_dispatch (application_status, is_online, home_city_id),
    CONSTRAINT fk_c2c_driver_user FOREIGN KEY (user_id) REFERENCES users(User_ID_Pk),
    CONSTRAINT fk_c2c_driver_city FOREIGN KEY (home_city_id) REFERENCES city(ID_PK),
    CONSTRAINT fk_c2c_driver_approver FOREIGN KEY (approved_by) REFERENCES employee(emp_id),
    CONSTRAINT chk_c2c_driver_online CHECK (is_online IN (0,1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS city_to_city_vehicles (
    id INT NOT NULL AUTO_INCREMENT,
    city_to_city_driver_id INT NOT NULL,
    vehicle_type VARCHAR(40) NOT NULL,
    make VARCHAR(60) NULL,
    model VARCHAR(60) NOT NULL,
    manufacture_year SMALLINT UNSIGNED NULL,
    registration_number VARCHAR(40) NOT NULL,
    color VARCHAR(30) NULL,
    passenger_capacity SMALLINT UNSIGNED NOT NULL COMMENT 'Excludes driver',
    max_parcel_weight_kg DECIMAL(8,2) NULL,
    parcel_capacity_notes TEXT NULL,
    approval_status ENUM('pending','approved','rejected','suspended') NOT NULL DEFAULT 'pending',
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_c2c_vehicle_owner (id, city_to_city_driver_id),
    UNIQUE KEY uq_c2c_driver_registration (city_to_city_driver_id, registration_number),
    CONSTRAINT fk_c2c_vehicle_driver FOREIGN KEY (city_to_city_driver_id) REFERENCES city_to_city_drivers(id),
    CONSTRAINT chk_c2c_vehicle_capacity CHECK (passenger_capacity > 0),
    CONSTRAINT chk_c2c_vehicle_weight CHECK (max_parcel_weight_kg IS NULL OR max_parcel_weight_kg > 0),
    CONSTRAINT chk_c2c_vehicle_active CHECK (is_active IN (0,1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS city_to_city_driver_services (
    id INT NOT NULL AUTO_INCREMENT,
    city_to_city_driver_id INT NOT NULL,
    service_id INT NOT NULL,
    service_type ENUM('shared','private','parcel') NOT NULL,
    approval_status ENUM('pending','approved','rejected','suspended') NOT NULL DEFAULT 'pending',
    is_enabled TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_c2c_driver_service (city_to_city_driver_id, service_id),
    CONSTRAINT fk_c2c_driver_master_service FOREIGN KEY (service_id, service_type) REFERENCES city_to_city_services(id, code),
    CONSTRAINT fk_c2c_service_driver FOREIGN KEY (city_to_city_driver_id) REFERENCES city_to_city_drivers(id),
    CONSTRAINT chk_c2c_service_enabled CHECK (is_enabled IN (0,1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS city_to_city_driver_documents (
    id INT NOT NULL AUTO_INCREMENT,
    city_to_city_driver_id INT NOT NULL,
    vehicle_id INT NULL,
    document_type VARCHAR(50) NOT NULL,
    source_driver_id INT NULL REFERENCES drivers(id),
    source_document_key VARCHAR(60) NULL,
    file_key VARCHAR(512) NOT NULL,
    expires_at DATETIME NULL,
    review_status ENUM('pending','approved','rejected','expired') NOT NULL DEFAULT 'pending',
    reviewed_by BIGINT UNSIGNED NULL,
    reviewed_at DATETIME NULL,
    rejection_reason TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_c2c_documents_review (review_status, expires_at),
    CONSTRAINT fk_c2c_document_driver FOREIGN KEY (city_to_city_driver_id) REFERENCES city_to_city_drivers(id),
    CONSTRAINT fk_c2c_document_vehicle FOREIGN KEY (vehicle_id, city_to_city_driver_id) REFERENCES city_to_city_vehicles(id, city_to_city_driver_id),
    CONSTRAINT fk_c2c_document_reviewer FOREIGN KEY (reviewed_by) REFERENCES employee(emp_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS city_to_city_requests (
    id INT NOT NULL AUTO_INCREMENT,
    customer_user_id INT NOT NULL,
    service_id INT NOT NULL,
    service_type ENUM('shared','private','parcel') NOT NULL,
    origin_city_id INT NOT NULL,
    destination_city_id INT NOT NULL,
    pickup_address VARCHAR(500) NOT NULL,
    pickup_lat DECIMAL(10,7) NOT NULL,
    pickup_lng DECIMAL(10,7) NOT NULL,
    dropoff_address VARCHAR(500) NOT NULL,
    dropoff_lat DECIMAL(10,7) NOT NULL,
    dropoff_lng DECIMAL(10,7) NOT NULL,
    departure_mode ENUM('now','scheduled') NOT NULL,
    requested_departure_at DATETIME NOT NULL,
    passenger_count SMALLINT UNSIGNED NULL,
    requested_vehicle_type VARCHAR(40) NULL,
    estimated_distance_km DECIMAL(10,2) NULL,
    estimated_duration_minutes INT UNSIGNED NULL,
    fare_rate_id INT NULL COMMENT 'NULL uses service default tariff',
    fare_snapshot LONGTEXT NULL COMMENT 'Server-generated JSON of tariff, inputs and calculation version; never client supplied',
    quote_expires_at DATETIME NULL,
    suggested_fare DECIMAL(12,2) NULL,
    customer_offer_amount DECIMAL(12,2) NULL,
    pricing_unit ENUM('per_seat','whole_car','per_delivery') NOT NULL,
    currency CHAR(3) NOT NULL DEFAULT 'PKR',
    comments TEXT NULL,
    status ENUM('open','booked','cancelled','expired') NOT NULL DEFAULT 'open',
    expires_at DATETIME NOT NULL,
    idempotency_key VARCHAR(64) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_c2c_request_retry (customer_user_id, idempotency_key),
    KEY idx_c2c_request_route (origin_city_id, destination_city_id, service_type, status, requested_departure_at),
    KEY idx_c2c_request_expiry (status, expires_at),
    CONSTRAINT fk_c2c_request_customer FOREIGN KEY (customer_user_id) REFERENCES users(User_ID_Pk),
    CONSTRAINT fk_c2c_request_master_service FOREIGN KEY (service_id, service_type) REFERENCES city_to_city_services(id, code),
    CONSTRAINT fk_c2c_request_rate FOREIGN KEY (fare_rate_id, service_id) REFERENCES city_to_city_fare_rates(id, service_id),
    CONSTRAINT chk_c2c_request_snapshot CHECK (fare_snapshot IS NULL OR JSON_VALID(fare_snapshot)),
    CONSTRAINT chk_c2c_request_distance CHECK (estimated_distance_km IS NULL OR estimated_distance_km >= 0),
    CONSTRAINT fk_c2c_request_origin FOREIGN KEY (origin_city_id) REFERENCES city(ID_PK),
    CONSTRAINT fk_c2c_request_destination FOREIGN KEY (destination_city_id) REFERENCES city(ID_PK),
    CONSTRAINT chk_c2c_request_cities CHECK (origin_city_id <> destination_city_id),
    CONSTRAINT chk_c2c_request_persons CHECK (
        (service_type = 'parcel' AND passenger_count IS NULL) OR
        (service_type IN ('shared','private') AND passenger_count IS NOT NULL AND passenger_count > 0)
    ),
    CONSTRAINT chk_c2c_request_pricing CHECK (
        (service_type = 'shared' AND pricing_unit = 'per_seat') OR
        (service_type = 'private' AND pricing_unit = 'whole_car') OR
        (service_type = 'parcel' AND pricing_unit = 'per_delivery')
    ),
    CONSTRAINT chk_c2c_request_fares CHECK (
        (suggested_fare IS NULL OR suggested_fare >= 0) AND
        (customer_offer_amount IS NULL OR customer_offer_amount >= 0)
    ),
    CONSTRAINT chk_c2c_request_coords CHECK (
        pickup_lat BETWEEN -90 AND 90 AND dropoff_lat BETWEEN -90 AND 90 AND
        pickup_lng BETWEEN -180 AND 180 AND dropoff_lng BETWEEN -180 AND 180
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS city_to_city_parcel_details (
    id INT NOT NULL AUTO_INCREMENT,
    request_id INT NOT NULL,
    sender_name VARCHAR(100) NOT NULL,
    sender_phone VARCHAR(25) NOT NULL,
    recipient_name VARCHAR(100) NOT NULL,
    recipient_phone VARCHAR(25) NOT NULL,
    description TEXT NOT NULL,
    package_count SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    weight_kg DECIMAL(8,2) NOT NULL,
    length_cm DECIMAL(8,2) NULL,
    width_cm DECIMAL(8,2) NULL,
    height_cm DECIMAL(8,2) NULL,
    declared_value DECIMAL(12,2) NULL,
    is_fragile TINYINT(1) NOT NULL DEFAULT 0,
    handling_notes TEXT NULL,
    pickup_code_hash VARCHAR(255) NULL,
    delivery_code_hash VARCHAR(255) NULL,
    pickup_verified_at DATETIME NULL,
    delivery_verified_at DATETIME NULL,
    proof_of_delivery_key VARCHAR(512) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_c2c_parcel_request (request_id),
    CONSTRAINT fk_c2c_parcel_request FOREIGN KEY (request_id) REFERENCES city_to_city_requests(id),
    CONSTRAINT chk_c2c_parcel_size CHECK (
        package_count > 0 AND weight_kg > 0 AND
        (length_cm IS NULL OR length_cm > 0) AND
        (width_cm IS NULL OR width_cm > 0) AND
        (height_cm IS NULL OR height_cm > 0)
    ),
    CONSTRAINT chk_c2c_parcel_value CHECK (declared_value IS NULL OR declared_value >= 0),
    CONSTRAINT chk_c2c_parcel_fragile CHECK (is_fragile IN (0,1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS city_to_city_trips (
    id INT NOT NULL AUTO_INCREMENT,
    city_to_city_driver_id INT NOT NULL,
    vehicle_id INT NOT NULL,
    service_id INT NOT NULL,
    trip_type ENUM('shared','private','parcel') NOT NULL,
    origin_city_id INT NOT NULL,
    destination_city_id INT NOT NULL,
    scheduled_departure_at DATETIME NOT NULL,
    estimated_arrival_at DATETIME NULL,
    actual_started_at DATETIME NULL,
    actual_completed_at DATETIME NULL,
    passenger_capacity SMALLINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Journey snapshot; zero for parcel-only trips',
    parcel_capacity_kg DECIMAL(8,2) NULL,
    status ENUM('planned','boarding','in_progress','completed','cancelled') NOT NULL DEFAULT 'planned',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_c2c_trip_vehicle (id, vehicle_id, city_to_city_driver_id),
    KEY idx_c2c_trip_route (origin_city_id, destination_city_id, trip_type, status, scheduled_departure_at),
    KEY idx_c2c_trip_driver_schedule (city_to_city_driver_id, status, scheduled_departure_at),
    CONSTRAINT fk_c2c_trip_master_service FOREIGN KEY (service_id, trip_type) REFERENCES city_to_city_services(id, code),
    CONSTRAINT fk_c2c_trip_vehicle FOREIGN KEY (vehicle_id, city_to_city_driver_id) REFERENCES city_to_city_vehicles(id, city_to_city_driver_id),
    CONSTRAINT fk_c2c_trip_origin FOREIGN KEY (origin_city_id) REFERENCES city(ID_PK),
    CONSTRAINT fk_c2c_trip_destination FOREIGN KEY (destination_city_id) REFERENCES city(ID_PK),
    CONSTRAINT chk_c2c_trip_cities CHECK (origin_city_id <> destination_city_id),
    CONSTRAINT chk_c2c_trip_capacity CHECK (
        (trip_type = 'parcel' AND passenger_capacity = 0 AND parcel_capacity_kg IS NOT NULL AND parcel_capacity_kg > 0) OR
        (trip_type IN ('shared','private') AND passenger_capacity > 0 AND parcel_capacity_kg IS NULL)
    ),
    CONSTRAINT chk_c2c_trip_eta CHECK (estimated_arrival_at IS NULL OR estimated_arrival_at > scheduled_departure_at),
    CONSTRAINT chk_c2c_trip_actual_times CHECK (actual_completed_at IS NULL OR (actual_started_at IS NOT NULL AND actual_completed_at >= actual_started_at))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS city_to_city_offers (
    id INT NOT NULL AUTO_INCREMENT,
    request_id INT NOT NULL,
    city_to_city_driver_id INT NOT NULL,
    vehicle_id INT NOT NULL,
    proposed_trip_id INT NULL,
    offered_amount DECIMAL(12,2) NOT NULL,
    pricing_unit ENUM('per_seat','whole_car','per_delivery') NOT NULL,
    estimated_pickup_at DATETIME NOT NULL,
    status ENUM('pending','accepted','rejected','withdrawn','expired') NOT NULL DEFAULT 'pending',
    expires_at DATETIME NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_c2c_offer_request (id, request_id),
    KEY idx_c2c_offer_request_status (request_id, status),
    KEY idx_c2c_offer_driver_status (city_to_city_driver_id, status),
    CONSTRAINT fk_c2c_offer_request FOREIGN KEY (request_id) REFERENCES city_to_city_requests(id),
    CONSTRAINT fk_c2c_offer_vehicle FOREIGN KEY (vehicle_id, city_to_city_driver_id) REFERENCES city_to_city_vehicles(id, city_to_city_driver_id),
    CONSTRAINT fk_c2c_offer_trip FOREIGN KEY (proposed_trip_id, vehicle_id, city_to_city_driver_id) REFERENCES city_to_city_trips(id, vehicle_id, city_to_city_driver_id),
    CONSTRAINT chk_c2c_offer_amount CHECK (offered_amount >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS city_to_city_bookings (
    id INT NOT NULL AUTO_INCREMENT,
    request_id INT NOT NULL,
    trip_id INT NOT NULL,
    accepted_offer_id INT NULL,
    fare_snapshot LONGTEXT NULL COMMENT 'Immutable accepted tariff, breakdown and cancellation policy, including service/rate IDs',
    passenger_count SMALLINT UNSIGNED NULL,
    unit_price DECIMAL(12,2) NOT NULL,
    fare_total DECIMAL(12,2) NOT NULL,
    platform_fee DECIMAL(12,2) NOT NULL DEFAULT 0,
    driver_earning DECIMAL(12,2) NOT NULL,
    currency CHAR(3) NOT NULL DEFAULT 'PKR',
    payment_method ENUM('cash','wallet','easypaisa','jazzcash','card') NOT NULL DEFAULT 'cash',
    payment_status ENUM('unpaid','pending','paid','failed','partially_refunded','refunded') NOT NULL DEFAULT 'unpaid',
    status ENUM('confirmed','picked_up','completed','cancelled','no_show') NOT NULL DEFAULT 'confirmed',
    cancelled_by_user_id INT NULL,
    cancellation_reason TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_c2c_booking_request (request_id),
    UNIQUE KEY uq_c2c_booking_offer (accepted_offer_id),
    UNIQUE KEY uq_c2c_booking_trip (id, trip_id),
    KEY idx_c2c_booking_capacity (trip_id, status),
    CONSTRAINT fk_c2c_booking_request FOREIGN KEY (request_id) REFERENCES city_to_city_requests(id),
    CONSTRAINT fk_c2c_booking_trip FOREIGN KEY (trip_id) REFERENCES city_to_city_trips(id),
    CONSTRAINT fk_c2c_booking_offer FOREIGN KEY (accepted_offer_id, request_id) REFERENCES city_to_city_offers(id, request_id),
    CONSTRAINT fk_c2c_booking_canceller FOREIGN KEY (cancelled_by_user_id) REFERENCES users(User_ID_Pk),
    CONSTRAINT chk_c2c_booking_snapshot CHECK (fare_snapshot IS NULL OR JSON_VALID(fare_snapshot)),
    CONSTRAINT chk_c2c_booking_persons CHECK (passenger_count IS NULL OR passenger_count > 0),
    CONSTRAINT chk_c2c_booking_amounts CHECK (unit_price >= 0 AND fare_total >= 0 AND platform_fee >= 0 AND driver_earning >= 0),
    CONSTRAINT chk_c2c_booking_split CHECK (platform_fee + driver_earning = fare_total)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS city_to_city_status_events (
    id BIGINT NOT NULL AUTO_INCREMENT,
    request_id INT NULL,
    trip_id INT NULL,
    booking_id INT NULL,
    actor_user_id INT NULL COMMENT 'NULL for system events',
    from_status VARCHAR(30) NULL,
    to_status VARCHAR(30) NOT NULL,
    reason TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_c2c_event_request (request_id, created_at),
    KEY idx_c2c_event_trip (trip_id, created_at),
    KEY idx_c2c_event_booking (booking_id, created_at),
    CONSTRAINT fk_c2c_event_request FOREIGN KEY (request_id) REFERENCES city_to_city_requests(id),
    CONSTRAINT fk_c2c_event_trip FOREIGN KEY (trip_id) REFERENCES city_to_city_trips(id),
    CONSTRAINT fk_c2c_event_booking FOREIGN KEY (booking_id) REFERENCES city_to_city_bookings(id),
    CONSTRAINT fk_c2c_event_actor FOREIGN KEY (actor_user_id) REFERENCES users(User_ID_Pk),
    CONSTRAINT chk_c2c_event_target CHECK (
        (request_id IS NOT NULL) + (trip_id IS NOT NULL) + (booking_id IS NOT NULL) = 1
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Application transactions must additionally enforce cross-row business rules:
-- 1. Approved driver/service/vehicle; matching request/trip service and route.
-- 2. Parcel details required only for parcel requests; booking persons match request.
-- 3. Lock the trip while reserving capacity; a private trip has one active booking.
-- 4. Accepted offer belongs to the booked driver/vehicle/trip and matches pricing.
-- 5. Prevent overlapping city/city-to-city work through the common user identity.
-- 6. Update statuses and insert audit events together; expire requests/offers in a job.
-- 7. Payment status is not a financial ledger; settle using idempotent ledger entries.
-- 8. Fetch display cards from city_to_city_services; enforce active flags, scheduling,
--    passenger/parcel limits and enabled pricing on the server. ENUMs describe the
--    three implemented behaviours, not an app-owned list of display cards.
-- 9. Resolve the complete tariff using the lookup order above. An exact matching
--    tariff with disabled pricing blocks that route/category; do not fall through.
--    Service is_pricing_enabled is the global pricing switch for that service.
-- 10. Calculate unit fare: fixed_fare OR base_fare + excess_km*per_km_rate +
--     excess_minutes*per_minute_rate + parcel excess_kg*extra_per_kg_rate + fragile.
--     Excess values are max(0, input - included allowance). Parcel billable weight
--     is max(actual, volumetric) if configured. Clamp to min/max, round to increment,
--     then clamp again. Shared multiplies unit fare by persons; private/parcel do not.
--     Add booking fee once, waiting charges once and extra actual tolls if configured;
--     tax applies to that subtotal. Fare snapshots must record tax/toll/fee components.
--     Quote totals exclude unknown future waiting/tolls and label those as extra.
-- 11. Platform commission is min(transport subtotal, percent*transport subtotal +
--     fixed commission); tax and actual toll reimbursements are excluded from that
--     base. platform_fee includes retained booking fee and tax; driver_earning is
--     fare_total - platform_fee. Financial ledger must track tax liabilities separately.
-- 12. Snapshot tariff + inputs + negotiated unit fare at quote and confirmation;
--     never recalculate old bookings using current master rates. Requote expired quotes.
--     Existing legacy rows may have NULL snapshots; do not fabricate historical fares.

SELECT TABLE_NAME
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN (
      'city_to_city_services', 'city_to_city_fare_rates',
      'city_to_city_drivers', 'city_to_city_vehicles',
      'city_to_city_driver_services', 'city_to_city_driver_documents',
      'city_to_city_requests', 'city_to_city_parcel_details',
      'city_to_city_trips', 'city_to_city_offers',
      'city_to_city_bookings', 'city_to_city_status_events'
  )
ORDER BY TABLE_NAME;

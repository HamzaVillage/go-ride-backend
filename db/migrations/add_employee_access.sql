-- MySQL / MariaDB. Independent employee identities; never inserts or updates users.
-- Existing installations must use setup:staff-identities to upgrade before this backend runs.

CREATE TABLE IF NOT EXISTS employee (
    emp_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    password_hash VARCHAR(255) NULL,
    account_type ENUM('employee','superadmin') NOT NULL DEFAULT 'employee',
    name VARCHAR(50) NOT NULL,
    email VARCHAR(100) NOT NULL,
    phone VARCHAR(30) NOT NULL,
    cnic VARCHAR(13) NULL,
    father_name VARCHAR(100) NULL,
    father_cnic VARCHAR(13) NULL,
    address VARCHAR(1000) NULL,
    cnic_front VARCHAR(100) NULL,
    cnic_back VARCHAR(100) NULL,
    other_document VARCHAR(100) NULL,
    version INT UNSIGNED NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by BIGINT UNSIGNED NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by BIGINT UNSIGNED NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    is_deleted TINYINT(1) NOT NULL DEFAULT 0,
    UNIQUE KEY uq_employee_email (email),
    UNIQUE KEY uq_employee_cnic (cnic),
    KEY ix_employee_status (is_deleted, is_active, emp_id),
    CONSTRAINT fk_employee_creator FOREIGN KEY (created_by) REFERENCES employee(emp_id),
    CONSTRAINT fk_employee_updater FOREIGN KEY (updated_by) REFERENCES employee(emp_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS employee_role (
    role_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    role_name VARCHAR(100) NOT NULL,
    role_description VARCHAR(1000) NULL,
    version INT UNSIGNED NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by BIGINT UNSIGNED NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by BIGINT UNSIGNED NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    is_deleted TINYINT(1) NOT NULL DEFAULT 0,
    UNIQUE KEY uq_employee_role_name (role_name),
    KEY ix_employee_role_status (is_deleted, is_active, role_id),
    CONSTRAINT fk_employee_role_creator FOREIGN KEY (created_by) REFERENCES employee(emp_id),
    CONSTRAINT fk_employee_role_updater FOREIGN KEY (updated_by) REFERENCES employee(emp_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS employee_function (
    function_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    function_name VARCHAR(100) NOT NULL,
    function_code VARCHAR(50) NOT NULL,
    version INT UNSIGNED NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by BIGINT UNSIGNED NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by BIGINT UNSIGNED NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    is_deleted TINYINT(1) NOT NULL DEFAULT 0,
    UNIQUE KEY uq_employee_function_code (function_code),
    CONSTRAINT fk_employee_function_creator FOREIGN KEY (created_by) REFERENCES employee(emp_id),
    CONSTRAINT fk_employee_function_updater FOREIGN KEY (updated_by) REFERENCES employee(emp_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS assign_role (
    assignment_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    emp_id BIGINT UNSIGNED NOT NULL,
    role_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by BIGINT UNSIGNED NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by BIGINT UNSIGNED NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    is_deleted TINYINT(1) NOT NULL DEFAULT 0,
    UNIQUE KEY uq_employee_role (emp_id, role_id),
    KEY ix_assign_role_reverse (role_id, is_deleted, is_active, emp_id),
    CONSTRAINT fk_assign_role_employee FOREIGN KEY (emp_id) REFERENCES employee(emp_id),
    CONSTRAINT fk_assign_role_role FOREIGN KEY (role_id) REFERENCES employee_role(role_id),
    CONSTRAINT fk_assign_role_creator FOREIGN KEY (created_by) REFERENCES employee(emp_id),
    CONSTRAINT fk_assign_role_updater FOREIGN KEY (updated_by) REFERENCES employee(emp_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS assign_role_function (
    can_view TINYINT(1) NOT NULL DEFAULT 0,
    can_add TINYINT(1) NOT NULL DEFAULT 0,
    can_edit TINYINT(1) NOT NULL DEFAULT 0,
    can_delete TINYINT(1) NOT NULL DEFAULT 0,
    assignment_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    role_id BIGINT UNSIGNED NOT NULL,
    function_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by BIGINT UNSIGNED NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by BIGINT UNSIGNED NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    is_deleted TINYINT(1) NOT NULL DEFAULT 0,
    UNIQUE KEY uq_role_function (role_id, function_id),
    KEY ix_assign_function_reverse (function_id, is_deleted, is_active, role_id),
    CONSTRAINT fk_role_function_role FOREIGN KEY (role_id) REFERENCES employee_role(role_id),
    CONSTRAINT fk_role_function_function FOREIGN KEY (function_id) REFERENCES employee_function(function_id),
    CONSTRAINT fk_assign_role_function_creator FOREIGN KEY (created_by) REFERENCES employee(emp_id),
    CONSTRAINT fk_assign_role_function_updater FOREIGN KEY (updated_by) REFERENCES employee(emp_id)
) ENGINE=InnoDB;

-- Numeric codes map to registered screens without duplicating legacy aliases.
INSERT INTO employee_function (function_code,function_name) SELECT '01','Overview' WHERE NOT EXISTS (SELECT 1 FROM employee_function WHERE function_code IN ('overview','01'));
INSERT INTO employee_function (function_code,function_name) SELECT '02','Rides' WHERE NOT EXISTS (SELECT 1 FROM employee_function WHERE function_code IN ('rides','02'));
INSERT INTO employee_function (function_code,function_name) SELECT '03','Drivers' WHERE NOT EXISTS (SELECT 1 FROM employee_function WHERE function_code IN ('drivers','03'));
INSERT INTO employee_function (function_code,function_name) SELECT '04','Riders' WHERE NOT EXISTS (SELECT 1 FROM employee_function WHERE function_code IN ('riders','04'));
INSERT INTO employee_function (function_code,function_name) SELECT '05','Franchises' WHERE NOT EXISTS (SELECT 1 FROM employee_function WHERE function_code IN ('franchises','05'));
INSERT INTO employee_function (function_code,function_name) SELECT '06','Chat reports' WHERE NOT EXISTS (SELECT 1 FROM employee_function WHERE function_code IN ('reports','06'));
INSERT INTO employee_function (function_code,function_name) SELECT '07','Support queries' WHERE NOT EXISTS (SELECT 1 FROM employee_function WHERE function_code IN ('support','07'));
INSERT INTO employee_function (function_code,function_name) SELECT '08','Notifications' WHERE NOT EXISTS (SELECT 1 FROM employee_function WHERE function_code IN ('notifications','08'));
INSERT INTO employee_function (function_code,function_name) SELECT '09','Settings' WHERE NOT EXISTS (SELECT 1 FROM employee_function WHERE function_code IN ('settings','09'));
INSERT INTO employee_function (function_code,function_name) SELECT '10','Employee access' WHERE NOT EXISTS (SELECT 1 FROM employee_function WHERE function_code IN ('employees','10'));
INSERT INTO employee_function (function_code,function_name) SELECT '11','Offers' WHERE NOT EXISTS (SELECT 1 FROM employee_function WHERE function_code IN ('offers','11'));
INSERT INTO employee_function (function_code,function_name) SELECT '12','City-to-City Drivers' WHERE NOT EXISTS (SELECT 1 FROM employee_function WHERE function_code IN ('city_to_city_drivers','12'));
INSERT INTO employee_function (function_code,function_name) SELECT '13','City-to-City Service & Fares' WHERE NOT EXISTS (SELECT 1 FROM employee_function WHERE function_code IN ('city_to_city_fares','13'));
INSERT INTO employee_function (function_code,function_name) SELECT '14','City-to-City Route Fares' WHERE NOT EXISTS (SELECT 1 FROM employee_function WHERE function_code IN ('city_to_city_routes','14'));
INSERT INTO employee_function (function_code,function_name) SELECT '15','City-to-City Fare Calculator' WHERE NOT EXISTS (SELECT 1 FROM employee_function WHERE function_code IN ('city_to_city_calculator','15'));
INSERT INTO employee_function (function_code,function_name) SELECT '16','Franchise Drivers & Riders' WHERE NOT EXISTS (SELECT 1 FROM employee_function WHERE function_code IN ('franchise_members','16'));

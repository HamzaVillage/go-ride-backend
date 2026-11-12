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

-- Stable codes map to registered admin routes. Do not rename deployed codes.
INSERT INTO employee_function (function_code, function_name) VALUES
('overview', 'Overview'),
('rides', 'Rides'),
('drivers', 'Drivers'),
('riders', 'Riders'),
('franchises', 'Franchises'),
('reports', 'Chat reports'),
('support', 'Support queries'),
('notifications', 'Notifications'),
('settings', 'Settings'),
('employees', 'Employee access')
ON DUPLICATE KEY UPDATE function_code = VALUES(function_code);

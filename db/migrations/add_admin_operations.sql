-- Apply after add_employee_access.sql and the existing franchise/users/drivers schema.
-- Adds independent screen permissions; assign these to the intended roles.
INSERT INTO employee_function (function_code,function_name) SELECT '12','City-to-City Drivers' WHERE NOT EXISTS (SELECT 1 FROM employee_function WHERE function_code IN ('city_to_city_drivers','12'));
INSERT INTO employee_function (function_code,function_name) SELECT '13','City-to-City Service & Fares' WHERE NOT EXISTS (SELECT 1 FROM employee_function WHERE function_code IN ('city_to_city_fares','13'));
INSERT INTO employee_function (function_code,function_name) SELECT '14','City-to-City Route Fares' WHERE NOT EXISTS (SELECT 1 FROM employee_function WHERE function_code IN ('city_to_city_routes','14'));
INSERT INTO employee_function (function_code,function_name) SELECT '15','City-to-City Fare Calculator' WHERE NOT EXISTS (SELECT 1 FROM employee_function WHERE function_code IN ('city_to_city_calculator','15'));
INSERT INTO employee_function (function_code,function_name) SELECT '16','Franchise Drivers & Riders' WHERE NOT EXISTS (SELECT 1 FROM employee_function WHERE function_code IN ('franchise_members','16'));
-- Existing vehicle-fares uses the settings API and therefore retains the settings function.
CREATE TABLE IF NOT EXISTS employee_franchise_access (
 employee_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
 franchise_id INT NOT NULL,
 updated_by BIGINT UNSIGNED NOT NULL,
 updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 CONSTRAINT fk_franchise_staff_employee FOREIGN KEY (employee_id) REFERENCES employee(emp_id),
 CONSTRAINT fk_franchise_staff_actor FOREIGN KEY (updated_by) REFERENCES employee(emp_id)
) ENGINE=InnoDB;
-- franchise_id deliberately matches the legacy franchiser.id logically; deployments may use different integer widths.
CREATE TABLE IF NOT EXISTS admin_franchise_member_requests (
 request_key CHAR(36) NOT NULL PRIMARY KEY,
 actor_id BIGINT UNSIGNED NOT NULL,
 franchise_id INT NOT NULL,
 fingerprint CHAR(64) NOT NULL,
 member_kind ENUM('driver','rider') NOT NULL,
 member_id INT NOT NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

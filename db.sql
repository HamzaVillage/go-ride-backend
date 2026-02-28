-- phpMyAdmin SQL Dump
-- version 5.2.3
-- https://www.phpmyadmin.net/
--
-- Host: localhost
-- Generation Time: Feb 28, 2026 at 08:28 PM
-- Server version: 10.5.29-MariaDB
-- PHP Version: 8.5.1

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";

--
-- Database: `GO_DB_KINPL_LUCIDITY`
--

-- --------------------------------------------------------

--
-- Table structure for table `company`
--

CREATE TABLE `company` (
  `Company_ID_Pk` int(11) NOT NULL,
  `TRX_ID` varchar(4) DEFAULT NULL,
  `Company_Name` varchar(50) DEFAULT NULL,
  `Company_Short_Name` varchar(25) DEFAULT NULL,
  `Application_Name` varchar(25) DEFAULT NULL,
  `App_Home_Path` varchar(100) DEFAULT NULL,
  `Location` varchar(100) DEFAULT NULL,
  `Address` varchar(50) DEFAULT NULL,
  `Adress1` varchar(100) DEFAULT NULL,
  `Mobile_No` varchar(50) DEFAULT NULL,
  `PTCL_No` varchar(50) DEFAULT NULL,
  `City` varchar(50) DEFAULT NULL,
  `Province` varchar(50) DEFAULT NULL,
  `Country` varchar(50) DEFAULT NULL,
  `URL` varchar(100) DEFAULT NULL,
  `Email` varchar(100) DEFAULT NULL,
  `User_ID_Fk` int(11) DEFAULT NULL,
  `Contact_Start_Date` date DEFAULT NULL,
  `Monthly_Charges` int(11) DEFAULT NULL,
  `Monthly_Charges_Date` date DEFAULT NULL,
  `Unique_ID` varchar(10) DEFAULT NULL,
  `Serial_Key` varchar(20) DEFAULT NULL,
  `Full_Logo` text DEFAULT NULL,
  `Logo` text DEFAULT NULL,
  `Letter_Head_Header` text DEFAULT NULL,
  `Letter_Head_Footer` text DEFAULT NULL,
  `Student_ID_Card_BG` text DEFAULT NULL,
  `Staff_ID_Card_BG` text DEFAULT NULL,
  `Staff_Visiting_Card_BG` text DEFAULT NULL,
  `Slide_1` text DEFAULT NULL,
  `Slide_2` text DEFAULT NULL,
  `Slide_3` text DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

-- --------------------------------------------------------

--
-- Table structure for table `drivers`
--

CREATE TABLE `drivers` (
  `id` int(11) NOT NULL,
  `User_ID_FK` int(11) DEFAULT NULL,
  `driver_code` varchar(20) DEFAULT NULL,
  `full_name` varchar(100) DEFAULT NULL,
  `father_name` varchar(100) DEFAULT NULL,
  `cnic` varchar(15) DEFAULT NULL,
  `Easypaisa` varchar(15) DEFAULT NULL,
  `Easypaisa_Active` tinyint(1) NOT NULL DEFAULT 0,
  `JazzCash` varchar(15) DEFAULT NULL,
  `JazzCash_Active` tinyint(1) NOT NULL DEFAULT 0,
  `dob` date DEFAULT NULL,
  `phone` varchar(15) DEFAULT NULL,
  `email` varchar(100) DEFAULT NULL,
  `address` text DEFAULT NULL,
  `city` varchar(50) DEFAULT NULL,
  `vehicle_type` varchar(20) DEFAULT NULL,
  `vehicle_model` varchar(50) DEFAULT NULL,
  `vehicle_number` varchar(20) DEFAULT NULL,
  `vehicle_color` varchar(30) DEFAULT NULL,
  `photo_path` varchar(255) DEFAULT NULL,
  `cnic_front_path` varchar(255) DEFAULT NULL,
  `cnic_back_path` varchar(255) DEFAULT NULL,
  `fingerprint_path` varchar(255) DEFAULT NULL,
  `license_path` varchar(255) DEFAULT NULL,
  `vehicle_doc_path` varchar(255) DEFAULT NULL,
  `status` enum('pending','active','inactive','blocked') DEFAULT 'pending',
  `join_date` date DEFAULT NULL,
  `password` varchar(255) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `Rating` decimal(3,0) DEFAULT NULL,
  `Is_Online` tinyint(1) DEFAULT 0,
  `Is_Available` tinyint(1) DEFAULT 1
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

-- --------------------------------------------------------

--
-- Table structure for table `login_log`
--

CREATE TABLE `login_log` (
  `ID_PK` int(11) NOT NULL,
  `User_ID_FK` int(11) DEFAULT NULL,
  `Login_Datetime` timestamp NULL DEFAULT NULL,
  `User_Name` varchar(50) DEFAULT NULL,
  `Passward_Entered` varchar(25) DEFAULT NULL,
  `Description` text DEFAULT NULL,
  `IP_Address` varchar(20) DEFAULT NULL
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

-- --------------------------------------------------------

--
-- Table structure for table `otp_verifications`
--

CREATE TABLE `otp_verifications` (
  `id` int(11) NOT NULL,
  `phone_number` varchar(20) NOT NULL,
  `otp_hash` varchar(255) NOT NULL,
  `purpose` varchar(50) DEFAULT 'verification',
  `attempts` int(11) DEFAULT 0,
  `verified` tinyint(1) DEFAULT 0,
  `expires_at` datetime NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `payload` text DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `privilages`
--

CREATE TABLE `privilages` (
  `Privilage_ID_Pk` int(11) NOT NULL,
  `User_ID_Fk` int(11) DEFAULT NULL,
  `User_Type` varchar(50) DEFAULT NULL,
  `Sno` int(11) DEFAULT NULL,
  `Fa_Fa_Icon` varchar(50) DEFAULT NULL,
  `Menu_Group` varchar(50) DEFAULT NULL,
  `Item` varchar(50) DEFAULT NULL,
  `Target` varchar(50) DEFAULT NULL,
  `Report_Name` varchar(100) DEFAULT NULL,
  `Open_In_NewTab` tinyint(1) DEFAULT NULL,
  `isHeading` tinyint(1) DEFAULT NULL,
  `isRestricted` tinyint(1) DEFAULT NULL,
  `Form_Wise_Privilages` varchar(10) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

-- --------------------------------------------------------

--
-- Table structure for table `ride_history`
--

CREATE TABLE `ride_history` (
  `Ride_ID_Pk` int(11) NOT NULL,
  `User_ID_Fk` int(11) NOT NULL,
  `Driver_ID_Fk` int(11) DEFAULT NULL,
  `Pickup_Location` varchar(255) NOT NULL,
  `Drop_Location` varchar(255) NOT NULL,
  `Pickup_Lat` decimal(10,8) NOT NULL,
  `Pickup_Lng` decimal(11,8) NOT NULL,
  `Drop_Lat` decimal(10,8) NOT NULL,
  `Drop_Lng` decimal(11,8) NOT NULL,
  `Distance` decimal(6,2) NOT NULL COMMENT 'in kilometers',
  `Duration` int(11) NOT NULL COMMENT 'in minutes',
  `Fare` decimal(8,2) NOT NULL,
  `Base_Fare` decimal(8,2) DEFAULT NULL,
  `Per_Km_Rate` decimal(8,2) DEFAULT NULL,
  `Night_Charge` decimal(8,2) DEFAULT 0.00,
  `Peak_Hour_Surcharge` decimal(8,2) DEFAULT 0.00,
  `Total_Waiting_Time` int(11) DEFAULT 0 COMMENT 'in minutes',
  `Waiting_Charges` decimal(8,2) DEFAULT 0.00,
  `Is_Peak_Hour` tinyint(1) DEFAULT 0,
  `Is_Night_Ride` tinyint(1) DEFAULT 0,
  `Payment_Method` enum('Cash','Card','Wallet','Easypaisa','JazzCash') DEFAULT 'Cash',
  `Vehicle_Type` varchar(50) DEFAULT NULL,
  `Ride_Status` enum('Requested','Accepted','Arrived','Started','Completed','Cancelled','Rejected') DEFAULT 'Requested',
  `Cancelled_By` enum('User','Driver','System') DEFAULT NULL,
  `Cancellation_Reason` text DEFAULT NULL,
  `Ride_Date` timestamp NOT NULL DEFAULT current_timestamp(),
  `Start_Time` timestamp NULL DEFAULT NULL,
  `Fee_Percentage` decimal(5,2) DEFAULT 0.00,
  `Organization_Fee` decimal(8,2) DEFAULT 0.00,
  `End_Time` timestamp NULL DEFAULT NULL,
  `CreatedAt` timestamp NOT NULL DEFAULT current_timestamp(),
  `UpdatedAt` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `ride_reviews`
--

CREATE TABLE `ride_reviews` (
  `Review_ID_Pk` int(11) NOT NULL,
  `Ride_ID_Fk` int(11) NOT NULL,
  `Reviewer_ID_Fk` int(11) NOT NULL,
  `Reviewee_ID_Fk` int(11) DEFAULT NULL,
  `Reviewer_Role` enum('User','Driver') NOT NULL,
  `Rating` tinyint(4) NOT NULL,
  `Feedback_Tags` text DEFAULT NULL,
  `Comment` text DEFAULT NULL,
  `CreatedAt` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `sysconfigsetup`
--

CREATE TABLE `sysconfigsetup` (
  `ride_service` tinyint(1) NOT NULL DEFAULT 0,
  `courier_service` tinyint(1) NOT NULL DEFAULT 0,
  `food_delivery_service` tinyint(1) NOT NULL DEFAULT 0,
  `grocery_service` tinyint(1) NOT NULL DEFAULT 0,
  `fare_increaser` tinyint(1) NOT NULL DEFAULT 0,
  `SCS_ID_Pk` int(11) NOT NULL,
  `Allow_Generate_Invoice` tinyint(1) NOT NULL,
  `Gen_Inv_Start_Date` date NOT NULL,
  `Gen_Inv_End_Date` date NOT NULL,
  `Debug_Qry` tinyint(1) NOT NULL,
  `this_Level` varchar(10) NOT NULL,
  `File_Extention` varchar(200) NOT NULL,
  `Student` varchar(15) NOT NULL,
  `Staff` varchar(15) NOT NULL,
  `Customer` varchar(15) NOT NULL,
  `Supplier` varchar(15) NOT NULL,
  `Bank1` varchar(15) NOT NULL,
  `Cash` varchar(15) NOT NULL,
  `Inventory_Items` varchar(15) NOT NULL,
  `Trans_Date` date NOT NULL,
  `Attendence_Date_Start` date NOT NULL,
  `Attendence_Date_End` date NOT NULL,
  `Payroll_Date` date NOT NULL,
  `Inventory_Date` date NOT NULL,
  `Absent_Late_Early` int(11) NOT NULL,
  `Gross_Salary` int(11) NOT NULL,
  `Loan_Installment` int(11) NOT NULL,
  `Advanced` decimal(10,0) NOT NULL,
  `Basic_Pay_Per` decimal(6,2) NOT NULL,
  `House_Rent_Per` decimal(6,2) NOT NULL,
  `Utility_Per` decimal(6,2) NOT NULL,
  `Medical_Per` decimal(6,2) NOT NULL,
  `Company_ID_Fk` int(11) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

-- --------------------------------------------------------

--
-- Table structure for table `users`
--

CREATE TABLE `users` (
  `User_ID_Pk` int(11) NOT NULL,
  `User_Name` varchar(50) DEFAULT NULL,
  `Email` varchar(100) DEFAULT NULL,
  `Role` varchar(25) DEFAULT NULL,
  `New_Order_Tone` varchar(25) DEFAULT NULL,
  `Create_Date` timestamp NULL DEFAULT current_timestamp(),
  `Password` varchar(100) DEFAULT NULL,
  `Device_Auth_Required` tinyint(1) DEFAULT NULL,
  `Mobile` varchar(50) DEFAULT NULL,
  `Authorized_Email` varchar(100) DEFAULT NULL,
  `Authorized_User_Type` varchar(25) DEFAULT NULL,
  `Authorized_Companies` varchar(50) DEFAULT NULL,
  `Cnic` varchar(50) DEFAULT NULL,
  `Address` varchar(100) DEFAULT NULL,
  `Address1` varchar(100) DEFAULT NULL,
  `City` varchar(50) DEFAULT NULL,
  `Country` varchar(50) DEFAULT NULL,
  `User_Pic` text DEFAULT NULL,
  `Unique_ID` varchar(100) DEFAULT NULL,
  `Forgot_Password` varchar(10) DEFAULT NULL,
  `User_Type` varchar(40) DEFAULT NULL,
  `UpLine_MobileNo` varchar(15) DEFAULT NULL,
  `UpLine_Email` varchar(100) DEFAULT NULL,
  `SafeLogout_Datetime` datetime DEFAULT NULL,
  `Company_ID_Fk` int(11) DEFAULT NULL,
  `Email_Sent` tinyint(1) DEFAULT NULL,
  `Country_Code` varchar(5) DEFAULT NULL,
  `Email_Verification_Status` varchar(10) DEFAULT NULL,
  `Email_Verify_Code` varchar(10) DEFAULT NULL,
  `Mobile_Verification_Status` varchar(10) DEFAULT NULL,
  `Mobile_Verify_Code` varchar(10) DEFAULT NULL,
  `Device_Verification_Status` varchar(10) DEFAULT NULL,
  `Device_Verification_Code` varchar(10) DEFAULT NULL,
  `Staff_ID_Fk` int(11) DEFAULT NULL,
  `Parent_ID_FK` int(11) DEFAULT NULL,
  `Coordinates` varchar(50) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

-- --------------------------------------------------------

--
-- Table structure for table `user_addresses`
--

CREATE TABLE `user_addresses` (
  `Address_ID_Pk` int(11) NOT NULL,
  `User_ID_Fk` int(11) NOT NULL,
  `Title` varchar(50) NOT NULL COMMENT 'e.g. Home, Office, Other',
  `Address` text NOT NULL,
  `Lat` decimal(10,7) DEFAULT NULL,
  `Lng` decimal(10,7) DEFAULT NULL,
  `City` varchar(100) DEFAULT NULL,
  `Note` varchar(255) DEFAULT NULL,
  `Is_Default` tinyint(1) DEFAULT 0,
  `CreatedAt` timestamp NOT NULL DEFAULT current_timestamp(),
  `UpdatedAt` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

-- --------------------------------------------------------

--
-- Table structure for table `vehicle_fare_rate`
--

CREATE TABLE `vehicle_fare_rate` (
  `Rate_ID_Pk` int(11) NOT NULL,
  `Vehicle_Type` varchar(50) NOT NULL,
  `Fee_Percentage` decimal(6,2) NOT NULL DEFAULT 0.00,
  `Base_Fare` decimal(8,2) NOT NULL COMMENT 'Minimum fare for first kilometer',
  `Per_Km_Rate` decimal(8,2) NOT NULL COMMENT 'Rate per kilometer after first km',
  `Per_Minute_Rate` decimal(8,2) NOT NULL COMMENT 'Rate per minute (waiting/traffic)',
  `Night_Charge_Percent` int(11) DEFAULT 20 COMMENT 'Percentage increase (10 = 10%)',
  `Peak_Hours_Percent` int(11) DEFAULT 25 COMMENT 'Percentage increase during peak hours',
  `Minimum_Distance` decimal(5,2) DEFAULT 1.00 COMMENT 'Minimum chargeable distance in km',
  `Maximum_Distance` decimal(6,2) DEFAULT 50.00 COMMENT 'Maximum allowed distance in km',
  `Currency` varchar(10) DEFAULT 'PKR',
  `Is_Active` tinyint(1) DEFAULT 1,
  `CreatedAt` timestamp NOT NULL DEFAULT current_timestamp(),
  `UpdatedAt` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `verifications`
--

CREATE TABLE `verifications` (
  `id` int(11) NOT NULL,
  `driver_id` int(11) NOT NULL,
  `admin_id` int(11) DEFAULT NULL,
  `status` enum('pending','approved','rejected') DEFAULT 'pending',
  `reason` text DEFAULT NULL,
  `verified_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp()
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

-- --------------------------------------------------------

--
-- Table structure for table `vouchers`
--

CREATE TABLE `vouchers` (
  `id` int(11) NOT NULL,
  `voucher_code` varchar(20) NOT NULL,
  `driver_id` int(11) DEFAULT NULL,
  `driver_name` varchar(100) DEFAULT NULL,
  `driver_phone` varchar(15) DEFAULT NULL,
  `denomination` decimal(10,2) NOT NULL,
  `notes` varchar(20) NOT NULL,
  `amount` int(11) NOT NULL,
  `status` enum('active','used','expired','cancelled') DEFAULT 'active',
  `issue_date` date NOT NULL,
  `expiry_date` date NOT NULL,
  `used_date` date DEFAULT NULL,
  `used_for` text DEFAULT NULL,
  `issued_by` int(11) DEFAULT NULL,
  `issued_by_name` varchar(100) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

-- --------------------------------------------------------

--
-- Table structure for table `voucher_transactions`
--

CREATE TABLE `voucher_transactions` (
  `id` int(11) NOT NULL,
  `voucher_id` int(11) NOT NULL,
  `transaction_type` enum('issue','use','cancel','reissue') DEFAULT NULL,
  `amount` decimal(10,2) DEFAULT NULL,
  `user_id` int(11) DEFAULT NULL,
  `user_name` varchar(100) DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp()
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

--
-- Indexes for dumped tables
--

--
-- Indexes for table `company`
--
ALTER TABLE `company`
  ADD PRIMARY KEY (`Company_ID_Pk`);

--
-- Indexes for table `drivers`
--
ALTER TABLE `drivers`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `driver_code` (`driver_code`),
  ADD UNIQUE KEY `cnic` (`cnic`),
  ADD KEY `idx_status` (`status`),
  ADD KEY `idx_city` (`city`),
  ADD KEY `idx_created_at` (`created_at`);

--
-- Indexes for table `login_log`
--
ALTER TABLE `login_log`
  ADD PRIMARY KEY (`ID_PK`);

--
-- Indexes for table `otp_verifications`
--
ALTER TABLE `otp_verifications`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_phone` (`phone_number`),
  ADD KEY `idx_expires` (`expires_at`),
  ADD KEY `idx_verified` (`verified`),
  ADD KEY `idx_phone_purpose` (`phone_number`,`purpose`);

--
-- Indexes for table `privilages`
--
ALTER TABLE `privilages`
  ADD PRIMARY KEY (`Privilage_ID_Pk`),
  ADD KEY `User_ID_FK` (`User_ID_Fk`),
  ADD KEY `User_ID_Fk_2` (`User_ID_Fk`,`Target`,`Report_Name`),
  ADD KEY `Menu_Group` (`Menu_Group`);

--
-- Indexes for table `ride_history`
--
ALTER TABLE `ride_history`
  ADD PRIMARY KEY (`Ride_ID_Pk`),
  ADD KEY `idx_user_id` (`User_ID_Fk`),
  ADD KEY `idx_driver_id` (`Driver_ID_Fk`),
  ADD KEY `idx_ride_status` (`Ride_Status`),
  ADD KEY `idx_ride_date` (`Ride_Date`),
  ADD KEY `idx_user_ride_date` (`User_ID_Fk`,`Ride_Date`);

--
-- Indexes for table `ride_reviews`
--
ALTER TABLE `ride_reviews`
  ADD PRIMARY KEY (`Review_ID_Pk`),
  ADD UNIQUE KEY `unique_review` (`Ride_ID_Fk`,`Reviewer_ID_Fk`);

--
-- Indexes for table `sysconfigsetup`
--
ALTER TABLE `sysconfigsetup`
  ADD PRIMARY KEY (`SCS_ID_Pk`);

--
-- Indexes for table `users`
--
ALTER TABLE `users`
  ADD PRIMARY KEY (`User_ID_Pk`),
  ADD KEY `Email` (`Email`) USING BTREE;

--
-- Indexes for table `user_addresses`
--
ALTER TABLE `user_addresses`
  ADD PRIMARY KEY (`Address_ID_Pk`);

--
-- Indexes for table `vehicle_fare_rate`
--
ALTER TABLE `vehicle_fare_rate`
  ADD PRIMARY KEY (`Rate_ID_Pk`),
  ADD UNIQUE KEY `Vehicle_Type` (`Vehicle_Type`),
  ADD KEY `idx_vehicle_type` (`Vehicle_Type`),
  ADD KEY `idx_active` (`Is_Active`);

--
-- Indexes for table `verifications`
--
ALTER TABLE `verifications`
  ADD PRIMARY KEY (`id`),
  ADD KEY `driver_id` (`driver_id`);

--
-- Indexes for table `vouchers`
--
ALTER TABLE `vouchers`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `voucher_code` (`voucher_code`),
  ADD KEY `idx_voucher_code` (`voucher_code`),
  ADD KEY `idx_driver_id` (`driver_id`),
  ADD KEY `idx_status` (`status`),
  ADD KEY `idx_expiry_date` (`expiry_date`);

--
-- Indexes for table `voucher_transactions`
--
ALTER TABLE `voucher_transactions`
  ADD PRIMARY KEY (`id`),
  ADD KEY `voucher_id` (`voucher_id`);

--
-- AUTO_INCREMENT for dumped tables
--

--
-- AUTO_INCREMENT for table `company`
--
ALTER TABLE `company`
  MODIFY `Company_ID_Pk` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `drivers`
--
ALTER TABLE `drivers`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `login_log`
--
ALTER TABLE `login_log`
  MODIFY `ID_PK` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `otp_verifications`
--
ALTER TABLE `otp_verifications`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `privilages`
--
ALTER TABLE `privilages`
  MODIFY `Privilage_ID_Pk` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `ride_history`
--
ALTER TABLE `ride_history`
  MODIFY `Ride_ID_Pk` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `ride_reviews`
--
ALTER TABLE `ride_reviews`
  MODIFY `Review_ID_Pk` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `sysconfigsetup`
--
ALTER TABLE `sysconfigsetup`
  MODIFY `SCS_ID_Pk` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `users`
--
ALTER TABLE `users`
  MODIFY `User_ID_Pk` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `user_addresses`
--
ALTER TABLE `user_addresses`
  MODIFY `Address_ID_Pk` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `vehicle_fare_rate`
--
ALTER TABLE `vehicle_fare_rate`
  MODIFY `Rate_ID_Pk` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `verifications`
--
ALTER TABLE `verifications`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `vouchers`
--
ALTER TABLE `vouchers`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `voucher_transactions`
--
ALTER TABLE `voucher_transactions`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;
COMMIT;

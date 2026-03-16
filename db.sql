-- phpMyAdmin SQL Dump
-- version 5.2.3
-- https://www.phpmyadmin.net/
--
-- Host: localhost
-- Generation Time: Mar 16, 2026 at 06:38 PM
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
-- Table structure for table `appeal_restore`
--

CREATE TABLE `appeal_restore` (
  `restore_id` int(11) NOT NULL,
  `user_name` varchar(100) NOT NULL,
  `email` varchar(255) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `restore_message` text DEFAULT NULL,
  `restore_status` enum('pending','approved','rejected') DEFAULT 'pending',
  `ip_address` varchar(45) DEFAULT NULL,
  `user_agent` text DEFAULT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `area`
--

CREATE TABLE `area` (
  `ID_PK` int(11) NOT NULL,
  `Area_Name` varchar(50) NOT NULL,
  `City_Name` varchar(80) NOT NULL,
  `Status` enum('active','inactive') NOT NULL DEFAULT 'active',
  `Created_At` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

-- --------------------------------------------------------

--
-- Table structure for table `city`
--

CREATE TABLE `city` (
  `ID_PK` int(11) NOT NULL,
  `City_Code` varchar(5) NOT NULL,
  `City_Name` varchar(80) NOT NULL,
  `Country` varchar(80) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

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
-- Table structure for table `contact_us_info`
--

CREATE TABLE `contact_us_info` (
  `id` int(11) NOT NULL,
  `address` text NOT NULL,
  `phone` varchar(50) NOT NULL,
  `email` varchar(100) NOT NULL,
  `is_active` tinyint(4) DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `drivers`
--

CREATE TABLE `drivers` (
  `id` int(11) NOT NULL,
  `User_ID_FK` int(11) DEFAULT NULL,
  `Franchiser_ID_FK` int(11) DEFAULT NULL,
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
  `Is_Available` tinyint(1) DEFAULT 1,
  `driver_earnings_sum` decimal(10,2) NOT NULL DEFAULT 0.00 COMMENT 'SUM(Driver_Earning) from driver_earnings',
  `completed_rides_count` int(11) NOT NULL DEFAULT 0 COMMENT 'COUNT(*) from driver_earnings',
  `overdue_since` datetime DEFAULT NULL COMMENT 'When driver first met limit; NULL = not overdue',
  `fcm_token` varchar(512) DEFAULT NULL COMMENT 'Firebase Cloud Messaging token for push notifications',
  `fcm_token_updated_at` timestamp NULL DEFAULT NULL ON UPDATE current_timestamp()
) ENGINE=MyISAM DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

-- --------------------------------------------------------

--
-- Table structure for table `driver_earnings`
--

CREATE TABLE `driver_earnings` (
  `Earning_ID_Pk` int(11) NOT NULL,
  `Ride_ID_Fk` int(11) DEFAULT NULL,
  `Driver_ID_Fk` int(11) DEFAULT NULL,
  `full_name` varchar(50) DEFAULT NULL,
  `father_name` varchar(50) DEFAULT NULL,
  `cnic` varchar(18) DEFAULT NULL,
  `driver_code` varchar(10) DEFAULT NULL,
  `Franchiser_ID_FK` int(11) DEFAULT NULL,
  `User_ID_FK` int(11) DEFAULT NULL,
  `Easypaisa` varchar(15) DEFAULT NULL,
  `Easypaisa_Active` tinyint(1) DEFAULT NULL,
  `JazzCash` varchar(15) DEFAULT NULL,
  `JazzCash_Active` tinyint(1) DEFAULT NULL,
  `dob` date DEFAULT NULL,
  `phone` varchar(15) DEFAULT NULL,
  `email` varchar(100) DEFAULT NULL,
  `address` varchar(100) DEFAULT NULL,
  `city` varchar(50) DEFAULT NULL,
  `vehicle_color` varchar(15) DEFAULT NULL,
  `vehicle_model` varchar(50) DEFAULT NULL,
  `vehicle_number` varchar(10) DEFAULT NULL,
  `join_date` date DEFAULT NULL,
  `Rating` decimal(4,2) DEFAULT NULL,
  `Total_Fare` decimal(8,2) DEFAULT NULL COMMENT 'Amount rider paid (from ride_history.Fare)',
  `Organization_Fee` decimal(8,2) NOT NULL DEFAULT 0.00,
  `Driver_Earning` decimal(8,2) DEFAULT NULL COMMENT 'Total_Fare - Organization_Fee',
  `Payment_Method` enum('Cash','Card','Wallet','Easypaisa','JazzCash') DEFAULT 'Cash',
  `status` varchar(15) DEFAULT NULL,
  `Is_Online` tinyint(1) DEFAULT NULL,
  `Is_Available` tinyint(1) DEFAULT NULL,
  `driver_earnings_sum` decimal(10,2) DEFAULT NULL,
  `completed_rides_count` int(11) DEFAULT NULL,
  `Vehicle_Type` varchar(50) DEFAULT NULL,
  `Earned_At` timestamp NOT NULL DEFAULT current_timestamp() COMMENT 'When ride was completed',
  `CreatedAt` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `driver_payments`
--

CREATE TABLE `driver_payments` (
  `id` int(11) NOT NULL,
  `driver_id` int(11) NOT NULL,
  `amount` decimal(10,2) NOT NULL,
  `payment_type` enum('advance','settlement','bonus','penalty') DEFAULT 'settlement',
  `payment_method` enum('cash','easypaisa','jazzcash','bank_transfer') NOT NULL,
  `transaction_id` varchar(100) DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `payment_date` timestamp NOT NULL DEFAULT current_timestamp(),
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `created_by` int(11) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `driver_wallet`
--

CREATE TABLE `driver_wallet` (
  `id` int(11) NOT NULL,
  `driver_id` int(11) NOT NULL,
  `transaction_type` enum('credit','debit') NOT NULL,
  `amount` decimal(10,2) NOT NULL,
  `description` text DEFAULT NULL,
  `reference_id` varchar(100) DEFAULT NULL,
  `payment_method` enum('cash','easypaisa','jazzcash','bank_transfer','other') DEFAULT 'cash',
  `status` enum('pending','completed','cancelled') DEFAULT 'completed',
  `transaction_date` timestamp NOT NULL DEFAULT current_timestamp(),
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `created_by` int(11) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `franchiser`
--

CREATE TABLE `franchiser` (
  `id` int(11) NOT NULL,
  `company_name` varchar(250) DEFAULT NULL,
  `legal_name` varchar(255) DEFAULT NULL,
  `contact_person` varchar(50) DEFAULT NULL,
  `registration_number` varchar(100) DEFAULT NULL,
  `tax_id` varchar(100) DEFAULT NULL,
  `email` varchar(250) DEFAULT NULL,
  `phone` varchar(50) DEFAULT NULL,
  `alternate_phone` varchar(50) DEFAULT NULL,
  `website` varchar(255) DEFAULT NULL,
  `address` varchar(255) DEFAULT NULL,
  `address_line2` varchar(255) DEFAULT NULL,
  `city` varchar(100) DEFAULT NULL,
  `area` varchar(50) DEFAULT NULL,
  `state` varchar(100) DEFAULT NULL,
  `postal_code` varchar(20) DEFAULT NULL,
  `country` varchar(100) DEFAULT 'USA',
  `industry_type` varchar(100) DEFAULT NULL,
  `business_description` text DEFAULT NULL,
  `year_established` year(4) DEFAULT NULL,
  `number_of_locations` int(11) DEFAULT 0,
  `total_employees` int(11) DEFAULT 0,
  `franchise_fee` decimal(15,2) DEFAULT 0.00,
  `royalty_fee` decimal(5,2) DEFAULT NULL,
  `marketing_fee` decimal(5,2) DEFAULT NULL,
  `minimum_capital_required` decimal(15,2) DEFAULT NULL,
  `contract_term_years` int(11) DEFAULT NULL,
  `renewal_option_years` int(11) DEFAULT NULL,
  `status` enum('active','inactive','pending','suspended') DEFAULT 'active',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `notes` text DEFAULT NULL,
  `profile_complete` tinyint(1) DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
-- Table structure for table `notifications`
--

CREATE TABLE `notifications` (
  `Notification_ID_Pk` int(11) NOT NULL,
  `Template_ID` int(11) DEFAULT NULL,
  `Target_Type` enum('all','role','specific') NOT NULL,
  `Target_Role` enum('driver','rider') DEFAULT NULL,
  `Target_User_Id` int(11) DEFAULT NULL,
  `Title` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Message_Body` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Data_Type` varchar(100) DEFAULT 'Go Ride - Pakistan',
  `Status` enum('pending','processing','sent','failed','cancelled') DEFAULT 'pending',
  `Priority` enum('high','normal','low') DEFAULT 'normal',
  `Api_Response` text DEFAULT NULL,
  `Retry_Count` int(11) DEFAULT 0,
  `Max_Retries` int(11) DEFAULT 3,
  `Scheduled_Time` datetime DEFAULT NULL,
  `Created_By` int(11) DEFAULT NULL,
  `Created_Date` datetime DEFAULT current_timestamp(),
  `Processed_Date` datetime DEFAULT NULL,
  `Sent_Date` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

-- --------------------------------------------------------

--
-- Table structure for table `notification_logs`
--

CREATE TABLE `notification_logs` (
  `Log_ID_Pk` int(11) NOT NULL,
  `Notification_ID` int(11) NOT NULL,
  `Action` varchar(50) NOT NULL,
  `Status` varchar(50) DEFAULT NULL,
  `Message` text DEFAULT NULL,
  `Created_Date` datetime DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci;

-- --------------------------------------------------------

--
-- Table structure for table `notification_templates`
--

CREATE TABLE `notification_templates` (
  `Template_ID_Pk` int(11) NOT NULL,
  `Template_Name` varchar(100) NOT NULL,
  `Title` varchar(255) DEFAULT NULL,
  `Message_Body` mediumtext NOT NULL,
  `Data_Type` varchar(100) DEFAULT 'Go Ride - Pakistan',
  `Icon` varchar(50) DEFAULT 'fa-bell',
  `Created_By` int(11) DEFAULT NULL,
  `Created_Date` datetime DEFAULT current_timestamp(),
  `Is_Active` tinyint(1) DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
  `Menu_Group` varchar(100) DEFAULT NULL,
  `Item` varchar(100) DEFAULT NULL,
  `Target` varchar(100) DEFAULT NULL,
  `Report_Name` varchar(100) DEFAULT NULL,
  `Open_In_NewTab` tinyint(1) DEFAULT 0,
  `isHeading` tinyint(1) DEFAULT 0,
  `isRestricted` tinyint(1) DEFAULT 0,
  `isHidenOption` tinyint(1) DEFAULT 0,
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
  `UpdatedAt` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `share_token` varchar(64) DEFAULT NULL
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
-- Table structure for table `support_tickets`
--

CREATE TABLE `support_tickets` (
  `id` int(11) NOT NULL,
  `ticket_number` varchar(20) NOT NULL,
  `franchise_id` varchar(50) DEFAULT '0',
  `user_id` int(11) NOT NULL,
  `staff_user_id` int(11) DEFAULT NULL,
  `full_name` varchar(100) DEFAULT NULL,
  `mobile_number` varchar(20) NOT NULL,
  `cnic_number` varchar(30) DEFAULT NULL,
  `service_type` enum('Rider Support','Driver Support','Food Delivery','Courier Service','Grocery Delivery') NOT NULL,
  `priority` enum('Low','Medium','High','Urgent','Emergency') DEFAULT 'Medium',
  `issue_description` text DEFAULT NULL,
  `status` enum('Open','In Progress','Resolved','Closed') DEFAULT 'Open',
  `created_by` int(11) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `closed_at` timestamp NULL DEFAULT NULL,
  `closed_by` int(11) DEFAULT NULL
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
  `Franchiser_ID_FK` int(11) DEFAULT 0,
  `Language` enum('English','Urdu') NOT NULL DEFAULT 'English',
  `New_Order_Tone` varchar(25) DEFAULT NULL,
  `Create_Date` timestamp NULL DEFAULT current_timestamp(),
  `Password` varchar(100) DEFAULT NULL,
  `Device_Auth_Required` tinyint(1) DEFAULT NULL,
  `Mobile` varchar(50) DEFAULT NULL,
  `AccountDeleted` tinyint(1) DEFAULT 0,
  `restored_at` datetime DEFAULT NULL,
  `restored_by` int(11) DEFAULT NULL,
  `AccountDeletionDate` datetime DEFAULT NULL,
  `AccountDeletionReason` varchar(50) DEFAULT NULL,
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
  `Coordinates` varchar(50) DEFAULT NULL,
  `fcm_token` varchar(512) DEFAULT NULL COMMENT 'Firebase Cloud Messaging token for push notifications',
  `fcm_token_updated_at` timestamp NULL DEFAULT NULL ON UPDATE current_timestamp()
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
  `UpdatedAt` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `rides_limit` int(11) NOT NULL DEFAULT 0 COMMENT 'Rides limit threshold (e.g. max rides per period)',
  `rides_over_limit_count` int(11) NOT NULL DEFAULT 0 COMMENT 'Count of rides over the limit'
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
-- Indexes for table `appeal_restore`
--
ALTER TABLE `appeal_restore`
  ADD PRIMARY KEY (`restore_id`),
  ADD KEY `idx_email` (`email`),
  ADD KEY `idx_status` (`restore_status`);

--
-- Indexes for table `area`
--
ALTER TABLE `area`
  ADD PRIMARY KEY (`ID_PK`),
  ADD KEY `Area_City` (`Area_Name`,`City_Name`),
  ADD KEY `Area` (`Area_Name`) USING BTREE;

--
-- Indexes for table `city`
--
ALTER TABLE `city`
  ADD PRIMARY KEY (`ID_PK`),
  ADD KEY `City` (`City_Name`);

--
-- Indexes for table `company`
--
ALTER TABLE `company`
  ADD PRIMARY KEY (`Company_ID_Pk`);

--
-- Indexes for table `contact_us_info`
--
ALTER TABLE `contact_us_info`
  ADD PRIMARY KEY (`id`);

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
-- Indexes for table `driver_earnings`
--
ALTER TABLE `driver_earnings`
  ADD PRIMARY KEY (`Earning_ID_Pk`),
  ADD UNIQUE KEY `unique_ride_earning` (`Ride_ID_Fk`),
  ADD KEY `idx_driver_earnings_driver` (`Driver_ID_Fk`),
  ADD KEY `idx_driver_earnings_earned_at` (`Earned_At`);

--
-- Indexes for table `driver_payments`
--
ALTER TABLE `driver_payments`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_driver_payment` (`driver_id`);

--
-- Indexes for table `driver_wallet`
--
ALTER TABLE `driver_wallet`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_driver_id` (`driver_id`),
  ADD KEY `idx_transaction_date` (`transaction_date`);

--
-- Indexes for table `franchiser`
--
ALTER TABLE `franchiser`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_company_name` (`company_name`),
  ADD KEY `idx_email` (`email`),
  ADD KEY `idx_status` (`status`),
  ADD KEY `idx_industry` (`industry_type`),
  ADD KEY `idx_country` (`country`);

--
-- Indexes for table `login_log`
--
ALTER TABLE `login_log`
  ADD PRIMARY KEY (`ID_PK`);

--
-- Indexes for table `notifications`
--
ALTER TABLE `notifications`
  ADD PRIMARY KEY (`Notification_ID_Pk`),
  ADD KEY `Template_ID` (`Template_ID`),
  ADD KEY `Target_User_Id` (`Target_User_Id`),
  ADD KEY `Created_By` (`Created_By`),
  ADD KEY `idx_notification_status` (`Status`),
  ADD KEY `idx_notification_created` (`Created_Date`),
  ADD KEY `idx_notification_scheduled` (`Scheduled_Time`);

--
-- Indexes for table `notification_logs`
--
ALTER TABLE `notification_logs`
  ADD PRIMARY KEY (`Log_ID_Pk`),
  ADD KEY `Notification_ID` (`Notification_ID`);

--
-- Indexes for table `notification_templates`
--
ALTER TABLE `notification_templates`
  ADD PRIMARY KEY (`Template_ID_Pk`),
  ADD KEY `Created_By` (`Created_By`);

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
  ADD KEY `idx_user_ride_date` (`User_ID_Fk`,`Ride_Date`),
  ADD UNIQUE KEY `idx_share_token` (`share_token`);

--
-- Indexes for table `ride_reviews`
--
ALTER TABLE `ride_reviews`
  ADD PRIMARY KEY (`Review_ID_Pk`),
  ADD UNIQUE KEY `unique_review` (`Ride_ID_Fk`,`Reviewer_ID_Fk`);

--
-- Indexes for table `support_tickets`
--
ALTER TABLE `support_tickets`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `ticket_number` (`ticket_number`),
  ADD KEY `idx_mobile` (`mobile_number`),
  ADD KEY `idx_cnic` (`cnic_number`),
  ADD KEY `idx_status` (`status`),
  ADD KEY `idx_franchise` (`franchise_id`);

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
-- AUTO_INCREMENT for table `appeal_restore`
--
ALTER TABLE `appeal_restore`
  MODIFY `restore_id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `area`
--
ALTER TABLE `area`
  MODIFY `ID_PK` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `city`
--
ALTER TABLE `city`
  MODIFY `ID_PK` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `company`
--
ALTER TABLE `company`
  MODIFY `Company_ID_Pk` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `contact_us_info`
--
ALTER TABLE `contact_us_info`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `drivers`
--
ALTER TABLE `drivers`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `driver_earnings`
--
ALTER TABLE `driver_earnings`
  MODIFY `Earning_ID_Pk` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `driver_payments`
--
ALTER TABLE `driver_payments`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `driver_wallet`
--
ALTER TABLE `driver_wallet`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `franchiser`
--
ALTER TABLE `franchiser`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `login_log`
--
ALTER TABLE `login_log`
  MODIFY `ID_PK` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `notifications`
--
ALTER TABLE `notifications`
  MODIFY `Notification_ID_Pk` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `notification_logs`
--
ALTER TABLE `notification_logs`
  MODIFY `Log_ID_Pk` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `notification_templates`
--
ALTER TABLE `notification_templates`
  MODIFY `Template_ID_Pk` int(11) NOT NULL AUTO_INCREMENT;

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
-- AUTO_INCREMENT for table `support_tickets`
--
ALTER TABLE `support_tickets`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

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

--
-- Constraints for dumped tables
--

--
-- Constraints for table `notifications`
--
ALTER TABLE `notifications`
  ADD CONSTRAINT `notifications_ibfk_1` FOREIGN KEY (`Template_ID`) REFERENCES `notification_templates` (`Template_ID_Pk`) ON DELETE SET NULL,
  ADD CONSTRAINT `notifications_ibfk_2` FOREIGN KEY (`Target_User_Id`) REFERENCES `users` (`User_ID_Pk`) ON DELETE SET NULL,
  ADD CONSTRAINT `notifications_ibfk_3` FOREIGN KEY (`Created_By`) REFERENCES `users` (`User_ID_Pk`) ON DELETE SET NULL;

--
-- Constraints for table `notification_logs`
--
ALTER TABLE `notification_logs`
  ADD CONSTRAINT `notification_logs_ibfk_1` FOREIGN KEY (`Notification_ID`) REFERENCES `notifications` (`Notification_ID_Pk`) ON DELETE CASCADE;

--
-- Constraints for table `notification_templates`
--
ALTER TABLE `notification_templates`
  ADD CONSTRAINT `notification_templates_ibfk_1` FOREIGN KEY (`Created_By`) REFERENCES `users` (`User_ID_Pk`) ON DELETE SET NULL;
COMMIT;

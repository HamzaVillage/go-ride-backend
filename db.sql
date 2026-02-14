-- phpMyAdmin SQL Dump
-- version 5.2.3
-- https://www.phpmyadmin.net/
--
-- Host: localhost
-- Generation Time: Feb 14, 2026 at 08:20 AM
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
-- Table structure for table `drivers`
--

CREATE TABLE `drivers` (
  `id` int(11) NOT NULL,
  `driver_code` varchar(20) DEFAULT NULL,
  `full_name` varchar(100) DEFAULT NULL,
  `father_name` varchar(100) DEFAULT NULL,
  `cnic` varchar(15) DEFAULT NULL,
  `Easypaisa` varchar(15) DEFAULT NULL,
  `JazzCash` varchar(15) DEFAULT NULL,
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

--
-- Dumping data for table `drivers`
--

INSERT INTO `drivers` (`id`, `driver_code`, `full_name`, `father_name`, `cnic`, `Easypaisa`, `JazzCash`, `dob`, `phone`, `email`, `address`, `city`, `vehicle_type`, `vehicle_model`, `vehicle_number`, `vehicle_color`, `photo_path`, `cnic_front_path`, `cnic_back_path`, `fingerprint_path`, `license_path`, `vehicle_doc_path`, `status`, `join_date`, `password`, `created_at`, `updated_at`, `Rating`, `Is_Online`, `Is_Available`) VALUES
(1, 'DRV001', 'Ali Ahmed', 'Ahmed Khan', '42101-1234567-1', NULL, NULL, '1990-10-20', '0300-1234567', '', 'House 123, Street 45, Gulshan', 'Karachi', 'Mini', '', 'ABC-123', '', 'uploads/driver_photo_1765927473_6941ea31b41dd.jpg', NULL, NULL, NULL, NULL, NULL, 'active', '2024-01-15', NULL, '2025-12-16 17:42:43', '2026-02-11 15:11:23', 0, 0, 1),
(2, 'DRV002', 'Usman Khan', 'Khalid Khan', '35202-7654321-2', NULL, NULL, '1981-02-11', '0312-9876543', '1riaz.zaheer@gmail.com', 'Sector F-10/4', 'Islamabad', 'Bike', '', 'XYZ-789', '', NULL, NULL, NULL, NULL, NULL, NULL, 'pending', '2024-02-01', '$2y$12$yu6v89LvLViII6XNUDHEXeim/VYnRZkr2hASK/xlgqvAECqtgDWpy', '2025-12-16 17:42:43', '2026-02-11 15:11:39', 0, 0, 1),
(4, 'DRV004', 'Bilal Raza', 'Raza Ahmed', '34501-2345678-4', NULL, NULL, '1970-02-11', '0345-2345678', '', 'Cantt Area', 'Rawalpindi', 'Auto', '', 'RWP-789', '', NULL, NULL, NULL, NULL, NULL, NULL, 'active', '2024-01-25', NULL, '2025-12-16 17:42:43', '2026-02-11 15:11:55', 0, 0, 1),
(5, 'DRV005', 'Ayesha Noor', 'Noor Muhammad', '41602-3456789-5', NULL, NULL, '2026-02-11', '0301-3456789', '', 'North Nazimabad', 'Karachi', 'Bike', '', 'KHI-123', '', 'uploads/driver_photo_1770817626_698c885a997b7.jpeg', NULL, NULL, NULL, NULL, NULL, 'blocked', '2024-02-10', NULL, '2025-12-16 17:42:43', '2026-02-11 15:12:12', 0, 0, 1),
(6, 'DRV4975', 'Riaz Zaheer', 'M Zaheer Uddin', '42000-0475551-9', '0308-2228873', '0308-2228873', '1972-06-20', '0308-2228873', 'riaz.zaheer@gmail.com', 'A-70, Sunny Heights, Block A-10, Gulshan e Iqbal,\r\nNear Eastern Toyota Motors', 'Karachi', 'AC', 'Mira', 'KIN-123', 'Blue', 'uploads/driver_photo_1765908936_6941a1c85e534.jpg', 'uploads/cnic_front_1765908533_6941a035e9649.jpeg', 'uploads/cnic_back_1765908533_6941a035e9716.jpeg', 'uploads/fingerprint_1765908533_6941a035e979e.jpeg', 'uploads/driving_license_1765909415_6941a3a7cc939.png', 'uploads/vehicle_document_1765909415_6941a3a7cca46.jpg', 'active', '2025-12-16', NULL, '2025-12-16 18:00:51', '2026-02-11 16:05:30', 0, 0, 1),
(11, 'DRV4049', 'Farooq Nawaz', 'Muhammad Nawaz', '52000-0475551-9', NULL, NULL, '1972-06-21', '0330-2490487', 'farooqnawaz@gmail.com', 'A-70,', 'Karachi', 'Mini', 'Alto', 'KIN-786', 'White', 'uploads/driver_photo_1770806365_698c5c5dab6a6.jpeg', 'uploads/cnic_front_1770807173_698c5f85b7053.jpeg', 'uploads/cnic_back_1770807173_698c5f85b711c.jpeg', 'uploads/fingerprint_1770807173_698c5f85b7181.jpeg', 'uploads/driving_license_1770807173_698c5f85b71f9.jpeg', 'uploads/vehicle_document_1770807173_698c5f85b7254.jpeg', 'pending', '2026-02-10', '$2y$12$CC14PzRIiC6BkJav1MO8WeGC303llH.gpQRzsfiJPjNcbbyEzJSgC', '2026-02-11 07:19:28', '2026-02-11 15:10:27', NULL, 0, 1),
(12, 'DRV6428', 'Adnan Zaheer', 'Zaheer Babar', '52001-0475551-9', '0987-098765', '0987-098765', '1979-02-11', '0308-2228879', 'riaz.zaheer@gmail.com', 'A-70, Sunny Heights, Block A-10, Gulshan e Iqbal,\r\nNear Eastern Toyota Motors', 'Karachi', 'AC', 'Alto', 'KIN-123', 'Blue', 'uploads/photo_1770825698_698ca7e27a0f7.avif', NULL, NULL, NULL, NULL, NULL, 'pending', '2026-02-11', NULL, '2026-02-11 16:01:38', '2026-02-11 16:01:38', NULL, 0, 1);

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
  `End_Time` timestamp NULL DEFAULT NULL,
  `CreatedAt` timestamp NOT NULL DEFAULT current_timestamp(),
  `UpdatedAt` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `ride_history`
--

INSERT INTO `ride_history` (`Ride_ID_Pk`, `User_ID_Fk`, `Driver_ID_Fk`, `Pickup_Location`, `Drop_Location`, `Pickup_Lat`, `Pickup_Lng`, `Drop_Lat`, `Drop_Lng`, `Distance`, `Duration`, `Fare`, `Base_Fare`, `Per_Km_Rate`, `Night_Charge`, `Peak_Hour_Surcharge`, `Total_Waiting_Time`, `Waiting_Charges`, `Is_Peak_Hour`, `Is_Night_Ride`, `Payment_Method`, `Vehicle_Type`, `Ride_Status`, `Cancelled_By`, `Cancellation_Reason`, `Ride_Date`, `Start_Time`, `End_Time`, `CreatedAt`, `UpdatedAt`) VALUES
(4, 1, 5, 'Jinnah International Airport', 'Clifton Beach', 24.90650000, 67.16070000, 24.81250000, 67.02860000, 18.50, 35, 850.00, NULL, NULL, 0.00, 0.00, 0, 0.00, 0, 0, 'Easypaisa', 'Mini', 'Completed', NULL, NULL, '2024-01-15 14:30:00', '2024-01-15 14:35:00', '2024-01-15 15:10:00', '2026-02-03 03:58:20', '2026-02-03 07:10:27'),
(5, 1, 2, 'Saddar Bazaar', 'Dolmen Mall Clifton', 24.86070000, 67.00980000, 24.81250000, 67.02860000, 8.20, 20, 450.00, NULL, NULL, 0.00, 0.00, 0, 0.00, 0, 0, 'Cash', NULL, 'Completed', NULL, NULL, '2024-01-14 16:45:00', '2024-01-14 16:50:00', '2024-01-14 17:10:00', '2026-02-03 03:58:20', '2026-02-03 04:05:53'),
(6, 1, 7, 'Tariq Road Market', 'Port Grand', 24.87110000, 67.06450000, 24.85480000, 66.99200000, 12.80, 28, 620.00, NULL, NULL, 0.00, 0.00, 0, 0.00, 0, 0, 'Easypaisa', NULL, 'Completed', NULL, NULL, '2024-01-13 19:20:00', '2024-01-13 19:25:00', '2024-01-13 19:53:00', '2026-02-03 03:58:20', '2026-02-03 04:05:53'),
(7, 1, 3, 'Bahria Town Karachi', 'Empress Market', 24.83500000, 67.19850000, 24.86070000, 67.00980000, 25.30, 45, 1100.00, NULL, NULL, 0.00, 0.00, 0, 0.00, 0, 0, 'Card', NULL, 'Completed', NULL, NULL, '2024-01-12 11:15:00', '2024-01-12 11:20:00', '2024-01-12 12:05:00', '2026-02-03 03:58:20', '2026-02-03 04:05:53'),
(8, 1, 1, 'Korangi Industrial Area', 'Seaview Beach', 24.81800000, 67.11450000, 24.81250000, 67.02860000, 10.50, 22, 520.00, NULL, NULL, 0.00, 0.00, 0, 0.00, 0, 0, 'Easypaisa', NULL, 'Completed', NULL, NULL, '2024-01-11 17:30:00', '2024-01-11 17:35:00', '2024-01-11 17:57:00', '2026-02-03 03:58:20', '2026-02-03 04:05:53'),
(9, 1, 6, 'Gulshan-e-Iqbal', 'DHA Phase 5', 24.90560000, 67.07720000, 24.80060000, 67.04500000, 12.00, 25, 580.00, NULL, NULL, 0.00, 0.00, 0, 0.00, 0, 0, 'Wallet', NULL, 'Completed', NULL, NULL, '2024-01-10 09:45:00', '2024-01-10 09:50:00', '2024-01-10 10:15:00', '2026-02-03 03:58:20', '2026-02-03 04:05:53'),
(10, 1, 4, 'Malir Cantt', 'Karachi Zoo', 24.89300000, 67.19330000, 24.88950000, 67.02880000, 18.20, 34, 830.00, NULL, NULL, 0.00, 0.00, 0, 0.00, 0, 0, 'Easypaisa', NULL, 'Completed', NULL, NULL, '2024-01-09 15:20:00', '2024-01-09 15:25:00', '2024-01-09 15:59:00', '2026-02-03 03:58:20', '2026-02-03 04:00:08'),
(11, 1, 8, 'North Nazimabad', 'Mazar-e-Quaid', 24.92800000, 67.04680000, 24.87460000, 67.03970000, 6.50, 15, 380.00, NULL, NULL, 0.00, 0.00, 0, 0.00, 0, 0, 'Cash', NULL, 'Completed', NULL, NULL, '2024-01-08 13:10:00', '2024-01-08 13:15:00', '2024-01-08 13:30:00', '2026-02-03 03:58:20', '2026-02-03 04:05:53'),
(12, 1, 2, 'Shah Faisal Colony', 'Do Darya Food Street', 24.87000000, 67.12200000, 24.81250000, 66.99200000, 15.80, 30, 720.00, NULL, NULL, 0.00, 0.00, 0, 0.00, 0, 0, 'Easypaisa', NULL, 'Completed', NULL, NULL, '2024-01-07 20:00:00', '2024-01-07 20:05:00', '2024-01-07 20:35:00', '2026-02-03 03:58:20', '2026-02-03 04:05:53'),
(13, 1, 5, 'Liaquatabad', 'Pakistan Maritime Museum', 24.91100000, 67.03450000, 24.85480000, 66.99200000, 8.70, 18, 420.00, NULL, NULL, 0.00, 0.00, 0, 0.00, 0, 0, 'Wallet', NULL, 'Completed', NULL, NULL, '2024-01-06 16:40:00', '2024-01-06 16:45:00', '2024-01-06 17:03:00', '2026-02-03 03:58:20', '2026-02-03 04:05:53'),
(14, 1, 7, 'Gulistan-e-Jauhar', 'Arabian Sea Country Club', 24.91850000, 67.13000000, 24.81250000, 67.02860000, 15.20, 29, 690.00, NULL, NULL, 0.00, 0.00, 0, 0.00, 0, 0, 'Easypaisa', NULL, 'Completed', NULL, NULL, '2024-01-05 12:30:00', '2024-01-05 12:35:00', '2024-01-05 13:04:00', '2026-02-03 03:58:20', '2026-02-03 04:05:53'),
(15, 1, 3, 'New Karachi', 'Frere Hall', 24.94000000, 67.06000000, 24.86070000, 67.00980000, 10.80, 23, 510.00, NULL, NULL, 0.00, 0.00, 0, 0.00, 0, 0, 'Cash', NULL, 'Completed', NULL, NULL, '2024-01-04 18:15:00', '2024-01-04 18:20:00', '2024-01-04 18:43:00', '2026-02-03 03:58:20', '2026-02-03 04:05:53'),
(16, 1, 1, 'FB Area Block 15', 'Boat Basin Park', 24.89800000, 67.07500000, 24.81250000, 67.02860000, 10.50, 22, 500.00, NULL, NULL, 0.00, 0.00, 0, 0.00, 0, 0, 'Easypaisa', NULL, 'Completed', NULL, NULL, '2024-01-03 14:50:00', '2024-01-03 14:55:00', '2024-01-03 15:17:00', '2026-02-03 03:58:20', '2026-02-03 04:05:53'),
(17, 1, NULL, 'Airport Heights', 'Sindh High Court', 24.90650000, 67.16070000, 24.86070000, 67.00980000, 19.00, 36, 880.00, NULL, NULL, 0.00, 0.00, 0, 0.00, 0, 0, 'Easypaisa', 'Auto-Rickshaw', 'Started', NULL, NULL, '2024-01-20 10:00:00', '2024-01-20 10:05:00', NULL, '2026-02-03 03:58:20', '2026-02-03 07:16:41'),
(18, 1, NULL, 'DHA Phase 6', 'Harbour Front', 24.80060000, 67.04500000, 24.85480000, 66.99200000, 8.30, 17, 430.00, NULL, NULL, 0.00, 0.00, 0, 0.00, 0, 0, 'Wallet', 'Auto-Rickshaw', 'Accepted', NULL, NULL, '2024-01-20 11:30:00', NULL, NULL, '2026-02-03 03:58:20', '2026-02-03 07:16:15'),
(19, 1, NULL, 'PECHS Block 2', 'Teen Talwar', 24.87100000, 67.06400000, 24.81250000, 67.02860000, 7.50, 16, 400.00, NULL, NULL, 0.00, 0.00, 0, 0.00, 0, 0, 'Easypaisa', 'Mini', 'Requested', NULL, NULL, '2024-01-20 12:15:00', NULL, NULL, '2026-02-03 03:58:20', '2026-02-03 07:16:01'),
(20, 1, 2, 'Gulshan-e-Maymar', 'Shahrah-e-Faisal', 24.95000000, 67.02000000, 24.87110000, 67.06450000, 12.50, 24, 600.00, NULL, NULL, 0.00, 0.00, 0, 0.00, 0, 0, 'Cash', NULL, 'Cancelled', NULL, NULL, '2024-01-02 09:30:00', NULL, NULL, '2026-02-03 03:58:20', '2026-02-03 04:05:53'),
(21, 1, 3, 'Landhi Industrial Area', 'Zamzama Park', 24.81800000, 67.11450000, 24.81250000, 67.02860000, 11.00, 21, 530.00, NULL, NULL, 0.00, 0.00, 0, 0.00, 0, 0, 'Easypaisa', NULL, 'Cancelled', NULL, NULL, '2024-01-01 17:45:00', NULL, NULL, '2026-02-03 03:58:20', '2026-02-03 04:05:53'),
(22, 2, 7, 'Karachi University', 'Merewether Tower', 24.92750000, 67.11390000, 24.86070000, 67.00980000, 14.20, 27, 670.00, NULL, NULL, 0.00, 0.00, 0, 0.00, 0, 0, 'Easypaisa', NULL, 'Completed', NULL, NULL, '2024-01-18 13:20:00', '2024-01-18 13:25:00', '2024-01-18 13:52:00', '2026-02-03 03:58:20', '2026-02-03 04:05:53'),
(23, 2, 5, 'Model Colony', 'Burns Road Food Street', 24.89300000, 67.19330000, 24.86070000, 67.00980000, 22.50, 42, 980.00, NULL, NULL, 0.00, 0.00, 0, 0.00, 0, 0, 'Wallet', NULL, 'Completed', NULL, NULL, '2024-01-17 19:10:00', '2024-01-17 19:15:00', '2024-01-17 19:57:00', '2026-02-03 03:58:20', '2026-02-03 04:05:53'),
(24, 1, 1, 'Cantt Station', 'Askari Park', 24.86070000, 67.00980000, 24.92800000, 67.04680000, 8.90, 19, 460.00, NULL, NULL, 0.00, 0.00, 0, 0.00, 0, 0, 'Easypaisa', NULL, 'Completed', NULL, NULL, '2023-12-28 10:45:00', '2023-12-28 10:50:00', '2023-12-28 11:09:00', '2026-02-03 03:58:20', '2026-02-03 04:05:53'),
(25, 1, 4, 'Karsaz', 'Hill Park', 24.87110000, 67.06450000, 24.88950000, 67.02880000, 4.50, 12, 280.00, NULL, NULL, 0.00, 0.00, 0, 0.00, 0, 0, 'Cash', NULL, 'Completed', NULL, NULL, '2023-12-25 16:20:00', '2023-12-25 16:25:00', '2023-12-25 16:37:00', '2026-02-03 03:58:20', '2026-02-03 04:00:08'),
(26, 1, 6, 'Orangi Town', 'I.I. Chundrigar Road', 24.94000000, 67.02000000, 24.86070000, 67.00980000, 9.80, 21, 480.00, NULL, NULL, 0.00, 0.00, 0, 0.00, 0, 0, 'Easypaisa', NULL, 'Completed', NULL, NULL, '2023-12-22 08:30:00', '2023-12-22 08:35:00', '2023-12-22 08:56:00', '2026-02-03 03:58:20', '2026-02-03 04:05:53'),
(27, 1, NULL, 'Jinnah International Airport', 'Bahria Town Karachi', 24.90650000, 67.16070000, 24.83500000, 67.19850000, 25.30, 45, 1100.00, NULL, NULL, 0.00, 0.00, 0, 0.00, 0, 0, 'Card', 'AC', 'Accepted', NULL, NULL, '2026-02-03 04:42:30', NULL, NULL, '2026-02-03 04:42:30', '2026-02-03 07:13:54'),
(28, 1, 5, 'Jinnah International Airport', 'Bahria Town Karachi', 24.90650000, 67.16070000, 24.83500000, 67.19850000, 25.30, 45, 1100.00, NULL, NULL, 0.00, 0.00, 0, 0.00, 0, 0, 'Card', NULL, 'Accepted', NULL, NULL, '2026-02-05 10:27:20', NULL, NULL, '2026-02-05 10:27:20', '2026-02-05 10:27:20'),
(29, 1, 5, 'Jinnah International Airport', 'Clifton Beach', 24.90650000, 67.16070000, 24.81250000, 67.02860000, 18.50, 35, 910.00, NULL, NULL, NULL, NULL, NULL, NULL, 0, 0, 'Easypaisa', 'Mini', 'Accepted', NULL, NULL, '2026-02-09 06:12:41', '2026-02-09 06:12:41', NULL, '2026-02-09 01:12:42', '2026-02-09 01:55:05'),
(30, 1, 5, 'Jinnah International Airport', 'Clifton Beach', 24.90650000, 67.16070000, 24.81250000, 67.02860000, 18.50, 35, 850.00, NULL, NULL, NULL, NULL, NULL, NULL, 0, 0, 'Easypaisa', 'bike', 'Accepted', NULL, NULL, '2026-02-11 12:26:05', '2026-02-11 12:26:05', NULL, '2026-02-11 07:26:05', '2026-02-11 07:28:04'),
(31, 601, NULL, 'Jinnah International Airport', 'Clifton Beach', 24.90650000, 67.16070000, 24.81250000, 67.02860000, 18.50, 35, 850.00, NULL, NULL, NULL, NULL, NULL, NULL, 0, 0, 'Easypaisa', 'Mini', 'Requested', NULL, NULL, '2026-02-11 12:38:19', '2026-02-11 12:38:19', NULL, '2026-02-11 07:38:19', '2026-02-11 07:38:19'),
(32, 601, 5, 'Jinnah International Airport', 'Clifton Beach', 24.90650000, 67.16070000, 24.81250000, 67.02860000, 18.50, 35, 850.00, NULL, NULL, NULL, NULL, NULL, NULL, 0, 0, 'Easypaisa', 'bike', 'Cancelled', 'User', 'Changed my mind or car trouble', '2026-02-11 12:39:08', '2026-02-11 12:39:08', NULL, '2026-02-11 07:39:08', '2026-02-11 07:47:57');

-- --------------------------------------------------------

--
-- Table structure for table `sysconfigsetup`
--

CREATE TABLE `sysconfigsetup` (
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

--
-- Dumping data for table `sysconfigsetup`
--

INSERT INTO `sysconfigsetup` (`SCS_ID_Pk`, `Allow_Generate_Invoice`, `Gen_Inv_Start_Date`, `Gen_Inv_End_Date`, `Debug_Qry`, `this_Level`, `File_Extention`, `Student`, `Staff`, `Customer`, `Supplier`, `Bank1`, `Cash`, `Inventory_Items`, `Trans_Date`, `Attendence_Date_Start`, `Attendence_Date_End`, `Payroll_Date`, `Inventory_Date`, `Absent_Late_Early`, `Gross_Salary`, `Loan_Installment`, `Advanced`, `Basic_Pay_Per`, `House_Rent_Per`, `Utility_Per`, `Medical_Per`, `Company_ID_Fk`) VALUES
(1, 0, '2025-11-17', '2025-11-30', 0, 'Z', 'hus,cnd,pxf,ofm,pof,pes,jef,exp,dsz,dsb,emb,dst,dtg,pdf,png,ai,eps,cdr,gif,bmp,jpg,jpeg,jfif,pjpeg,svg,webp', '111111', '222222', '3333', '444444', '55555', '666666', '77777', '2018-11-01', '2021-05-01', '2021-05-31', '2021-05-01', '2018-10-10', 0, 0, 0, 0, 55.00, 40.00, 10.00, 10.00, 1);

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

--
-- Dumping data for table `users`
--

INSERT INTO `users` (`User_ID_Pk`, `User_Name`, `Email`, `Role`, `New_Order_Tone`, `Create_Date`, `Password`, `Device_Auth_Required`, `Mobile`, `Authorized_Email`, `Authorized_User_Type`, `Authorized_Companies`, `Cnic`, `Address`, `Address1`, `City`, `Country`, `User_Pic`, `Unique_ID`, `Forgot_Password`, `User_Type`, `UpLine_MobileNo`, `UpLine_Email`, `SafeLogout_Datetime`, `Company_ID_Fk`, `Email_Sent`, `Country_Code`, `Email_Verification_Status`, `Email_Verify_Code`, `Mobile_Verification_Status`, `Mobile_Verify_Code`, `Device_Verification_Status`, `Device_Verification_Code`, `Staff_ID_Fk`, `Parent_ID_FK`, `Coordinates`) VALUES
(1, 'Riaz Zaheer', '1riaz.zaheer@gmail.com', 'CP Admin', '', '2024-06-23 14:59:51', 'Qmobile00!', 0, '0308-2228873', '', '', '', '', 'Sunny Heights', '', 'Karachi', 'Pakistan', 'images/profile/userprofile66215bcf7a8cb6.60976891.jpg', '5b8f9f5644cf6', '', 'CP Admin', '', 'riaz.zaheer@gmail.com', '2024-03-01 05:16:42', 1, 0, '', 'Verified', '', '', '', '', '', 0, 0, ''),
(598, 'Kashif', 'admin@goride.com', 'Rider', NULL, '2026-02-02 23:05:19', 'abc123', NULL, '03082228871', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
(600, 'John Doe', 'john@example.com', 'Rider', NULL, '2026-02-08 14:11:20', '$2b$10$PDwqUhP5H8OkT4ikhDZTjOZeTpA5y.iYSW0mnN1xNBv6QO687g1yO', NULL, '1234567890', NULL, NULL, NULL, '1234567890123', 'Main St', NULL, 'Islamabad', NULL, NULL, 'eaff8cbf2ff1ee5acc1018ea3a38b7bd', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
(601, 'John Doe', 'syed06411@gmail.com', 'Rider', NULL, '2026-02-08 16:13:42', '$2b$10$C.leqbK4h3nXXKDGld1zQ.GE4RqQo7fK.C9SvOr2EbY1HHaTkvtTS', NULL, '03112032255', NULL, NULL, NULL, '1234567890123', 'Main St', NULL, 'Islamabad', NULL, NULL, '4e6800a327505debb29e7e372eb11207', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
(602, 'Farooq Nawaz', 'farooqnawaz@gmail.com', 'Driver', NULL, '2026-02-11 07:19:28', NULL, NULL, '0330-2490487', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
(603, 'Usman Khan', '1riaz.zaheer@gmail.com', 'Driver', NULL, '2026-02-11 11:42:49', NULL, NULL, '0312-9876543', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
(604, 'Bilal Raza', '', 'Driver', NULL, '2026-02-11 11:44:46', NULL, NULL, '0345-2345678', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
(605, 'Ayesha Noor', '', 'Driver', NULL, '2026-02-11 13:47:06', NULL, NULL, '0301-3456789', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
(607, 'Ali Ahmed', '', 'Driver', NULL, '2026-02-11 15:00:16', NULL, NULL, '0300-1234567', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
(608, 'Adnan Zaheer', 'riaz.zaheer@gmail.com', 'Driver', NULL, '2026-02-11 16:01:38', NULL, NULL, '0308-2228879', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);

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

--
-- Dumping data for table `vehicle_fare_rate`
--

INSERT INTO `vehicle_fare_rate` (`Rate_ID_Pk`, `Vehicle_Type`, `Base_Fare`, `Per_Km_Rate`, `Per_Minute_Rate`, `Night_Charge_Percent`, `Peak_Hours_Percent`, `Minimum_Distance`, `Maximum_Distance`, `Currency`, `Is_Active`, `CreatedAt`, `UpdatedAt`) VALUES
(8, 'Auto-Rickshaw', 30.00, 25.00, 2.00, 20, 15, 1.00, 15.00, 'PKR', 1, '2026-02-03 04:53:43', '2026-02-11 10:32:11'),
(9, 'Bike', 25.00, 15.00, 1.00, 20, 15, 1.00, 10.00, 'PKR', 1, '2026-02-03 04:53:43', '2026-02-11 10:32:27'),
(10, 'Mini', 50.00, 35.00, 3.00, 20, 20, 1.00, 30.00, 'PKR', 1, '2026-02-03 04:53:43', '2026-02-11 10:32:38'),
(11, 'AC', 80.00, 45.00, 4.00, 25, 25, 1.00, 50.00, 'PKR', 1, '2026-02-03 04:53:43', '2026-02-11 10:32:47'),
(12, 'Premium', 100.00, 65.00, 6.00, 30, 25, 1.00, 50.00, 'PKR', 1, '2026-02-03 04:53:43', '2026-02-11 10:32:53'),
(13, 'XL', 80.00, 55.00, 5.00, 25, 25, 1.00, 50.00, 'PKR', 0, '2026-02-03 04:53:43', '2026-02-11 10:32:59'),
(14, 'Bike-Delivery', 25.00, 20.00, 1.50, 25, 15, 1.00, 20.00, 'PKR', 1, '2026-02-03 04:53:43', '2026-02-11 10:33:05');

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

--
-- Dumping data for table `verifications`
--

INSERT INTO `verifications` (`id`, `driver_id`, `admin_id`, `status`, `reason`, `verified_at`, `created_at`) VALUES
(1, 2, NULL, 'pending', 'Waiting for document verification', NULL, '2025-12-16 17:42:43'),
(2, 5, NULL, 'pending', 'License verification pending', NULL, '2025-12-16 17:42:43');

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

--
-- Dumping data for table `vouchers`
--

INSERT INTO `vouchers` (`id`, `voucher_code`, `driver_id`, `driver_name`, `driver_phone`, `denomination`, `notes`, `amount`, `status`, `issue_date`, `expiry_date`, `used_date`, `used_for`, `issued_by`, `issued_by_name`, `created_at`, `updated_at`) VALUES
(1, 'VCH1000-001', 1, 'Ali Ahmed', '0300-1234567', 1000.00, '', 1000, 'active', '2024-01-15', '2024-04-15', NULL, NULL, NULL, 'Admin 1', '2025-12-16 23:40:30', '2025-12-16 23:40:30'),
(2, 'VCH3000-001', 2, 'Usman Khan', '0312-9876543', 3000.00, '', 3000, 'active', '2024-01-10', '2024-04-10', NULL, NULL, NULL, 'Admin 2', '2025-12-16 23:40:30', '2025-12-18 05:42:44'),
(3, 'VCH5000-001', 3, 'Sara Fatima', '0333-4567890', 5000.00, '', 5000, 'active', '2024-01-20', '2024-04-20', NULL, NULL, NULL, 'Admin 1', '2025-12-16 23:40:30', '2025-12-16 23:40:30'),
(4, 'VCH1000-002', 4, 'Bilal Raza', '0345-2345678', 1000.00, '', 1000, 'active', '2023-12-01', '2024-03-01', NULL, NULL, NULL, 'Admin 3', '2025-12-16 23:40:30', '2025-12-18 05:42:30'),
(5, 'VCH3000-002', 5, 'Ayesha Noor', '0301-3456789', 3000.00, '', 3000, 'active', '2024-01-25', '2024-04-25', NULL, NULL, NULL, 'Admin 2', '2025-12-16 23:40:30', '2025-12-18 05:42:37'),
(8, 'VCH1,00000-45C280', 4, 'Bilal Raza', '0345-2345678', 1000.00, 'aaaa', 1000, 'active', '2025-12-17', '2026-03-17', NULL, NULL, NULL, 'Admin', '2025-12-17 17:41:13', '2025-12-17 17:41:13'),
(9, 'VCH5,00000-78FE09', 6, 'Riaz Zaheer', '0308-2228873', 5000.00, 'Top 10 Driver', 5000, 'active', '2025-12-17', '2026-03-17', NULL, NULL, NULL, 'Admin', '2025-12-17 18:12:13', '2025-12-17 18:12:13'),
(10, 'VCH3,00000-36F94B', 4, 'Bilal Raza', '0345-2345678', 3000.00, 'Top 10 Driver', 3000, 'active', '2025-12-18', '2026-03-18', NULL, NULL, NULL, 'Admin', '2025-12-18 05:39:45', '2025-12-18 05:39:45'),
(11, 'VCH5,00000-F9ACB3', 6, 'Riaz Zaheer', '0308-2228873', 5000.00, 'Top 10 Driver', 5000, 'active', '2025-12-18', '2026-03-18', NULL, NULL, NULL, 'Admin', '2025-12-18 07:10:40', '2025-12-18 07:10:40'),
(12, 'VCH3-32O0.LP6S59', 4, 'Bilal Raza', '0345-2345678', 3000.00, 'aaaaaa', 3000, 'active', '2025-12-18', '2026-03-18', NULL, NULL, NULL, 'Admin', '2025-12-18 07:22:16', '2025-12-18 07:30:54'),
(13, 'undefined', 6, 'Riaz Zaheer', '0308-2228873', 1000.00, 'fdfdfd', 1000, 'active', '2025-12-18', '2026-03-18', NULL, NULL, NULL, 'Admin', '2025-12-18 07:37:07', '2025-12-18 07:37:07'),
(14, 'VCH3-1CI0.CDZUPN', 4, 'Bilal Raza', '0345-2345678', 3000.00, 'fdfdfd', 3000, 'active', '2025-12-18', '2026-03-18', NULL, NULL, NULL, 'Admin', '2025-12-18 07:43:04', '2025-12-18 07:43:04'),
(15, 'VCH1-1PR0.RUB3D5', 6, 'Riaz Zaheer', '0308-2228873', 1000.00, 'fdfd', 1000, 'active', '2025-12-18', '2026-03-18', NULL, NULL, NULL, 'Admin', '2025-12-18 07:45:20', '2025-12-18 07:45:20');

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
-- Dumping data for table `voucher_transactions`
--

INSERT INTO `voucher_transactions` (`id`, `voucher_id`, `transaction_type`, `amount`, `user_id`, `user_name`, `notes`, `created_at`) VALUES
(1, 6, 'issue', 5000.00, NULL, 'Admin', 'aaaaaaaaaaaaaa', '2025-12-17 16:54:23'),
(2, 7, 'issue', 5000.00, NULL, 'Admin', 'Top 10 Driver', '2025-12-17 17:32:34'),
(3, 8, 'issue', 1000.00, NULL, 'Admin', 'aaaa', '2025-12-17 17:41:13'),
(4, 9, 'issue', 5000.00, NULL, 'Admin', 'Top 10 Driver', '2025-12-17 18:12:13'),
(5, 10, 'issue', 3000.00, NULL, 'Admin', 'Top 10 Driver', '2025-12-18 05:39:45'),
(6, 11, 'issue', 5000.00, NULL, 'Admin', 'Top 10 Driver', '2025-12-18 07:10:40'),
(7, 12, 'issue', 3000.00, NULL, 'Admin', 'aaaaaa', '2025-12-18 07:22:16'),
(8, 13, 'issue', 1000.00, NULL, 'Admin', 'fdfdfd', '2025-12-18 07:37:07'),
(9, 14, 'issue', 3000.00, NULL, 'Admin', 'fdfdfd', '2025-12-18 07:43:04'),
(10, 15, 'issue', 1000.00, NULL, 'Admin', 'fdfd', '2025-12-18 07:45:20');

--
-- Indexes for dumped tables
--

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
-- Indexes for table `otp_verifications`
--
ALTER TABLE `otp_verifications`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_phone` (`phone_number`),
  ADD KEY `idx_expires` (`expires_at`),
  ADD KEY `idx_verified` (`verified`),
  ADD KEY `idx_phone_purpose` (`phone_number`,`purpose`);

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
-- AUTO_INCREMENT for table `drivers`
--
ALTER TABLE `drivers`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=13;

--
-- AUTO_INCREMENT for table `otp_verifications`
--
ALTER TABLE `otp_verifications`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=14;

--
-- AUTO_INCREMENT for table `ride_history`
--
ALTER TABLE `ride_history`
  MODIFY `Ride_ID_Pk` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=33;

--
-- AUTO_INCREMENT for table `sysconfigsetup`
--
ALTER TABLE `sysconfigsetup`
  MODIFY `SCS_ID_Pk` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=102480;

--
-- AUTO_INCREMENT for table `users`
--
ALTER TABLE `users`
  MODIFY `User_ID_Pk` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=609;

--
-- AUTO_INCREMENT for table `user_addresses`
--
ALTER TABLE `user_addresses`
  MODIFY `Address_ID_Pk` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `vehicle_fare_rate`
--
ALTER TABLE `vehicle_fare_rate`
  MODIFY `Rate_ID_Pk` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=15;

--
-- AUTO_INCREMENT for table `verifications`
--
ALTER TABLE `verifications`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=3;

--
-- AUTO_INCREMENT for table `vouchers`
--
ALTER TABLE `vouchers`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=16;

--
-- AUTO_INCREMENT for table `voucher_transactions`
--
ALTER TABLE `voucher_transactions`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=11;
COMMIT;

const express = require('express');
const router = express.Router();
const authController = require('../controller/authController');

router.post('/send-otp', authController.sendOtp);
router.post('/verify-otp', authController.verifyOtp);
router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/logout', authController.logout);

// Driver Auth
router.post('/driver-login', authController.driverSendOtp);
router.post('/driver-verify-otp', authController.driverVerifyOtp);

router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);

module.exports = router;

const express = require('express');
const router = express.Router();
const notificationController = require('../controller/notificationController');
const adminAuthMiddleware = require('../utils/adminAuthMiddleware');

// Protected admin endpoint for push notifications
router.post('/send', adminAuthMiddleware, notificationController.sendNotification);

module.exports = router;

const express = require('express');
const { withScreenAccess } = require('../services/employeeAccess');
const router = express.Router();
const notificationController = require('../controller/notificationController');
const adminAuthMiddleware = require('../utils/adminAuthMiddleware');

// Protected admin endpoint for push notifications
router.post('/send', withScreenAccess(adminAuthMiddleware, 'notifications'), notificationController.sendNotification);

module.exports = router;

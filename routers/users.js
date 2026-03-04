const express = require('express');
const router = express.Router();
const userController = require('../controller/userController');
const authMiddleware = require('../utils/authMiddleware');

// Protected Profile Routes
router.get('/profile', authMiddleware, userController.getProfile);
router.put('/profile', authMiddleware, userController.updateProfile);
router.post('/fcm-token', authMiddleware, userController.updateFcmToken);

module.exports = router;

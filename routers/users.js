const express = require('express');
const router = express.Router();
const userController = require('../controller/userController');
const authMiddleware = require('../utils/authMiddleware');

// Protected Profile Routes (Customer)
router.get('/profile', authMiddleware, userController.getProfile);
router.put('/profile', authMiddleware, userController.updateProfile);

// Driver Account Routes
router.get('/driver-account', authMiddleware, userController.getDriverAccount);
router.put('/driver-account', authMiddleware, userController.updateDriverAccount);

router.post('/fcm-token', authMiddleware, userController.updateFcmToken);

module.exports = router;

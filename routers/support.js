const express = require('express');
const router = express.Router();
const supportController = require('../controller/supportController');
const authMiddleware = require('../utils/authMiddleware');

router.get('/info', supportController.getContactInfo);
router.post('/message', supportController.sendMessage);
router.post('/complaint', authMiddleware, supportController.submitComplaint);

module.exports = router;

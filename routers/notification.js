const express = require('express');
const router = express.Router();
const notificationController = require('../controller/notificationController');
// Note: We could add an adminAuthMiddleware here if we had one.
// For now, it's open but we'll assume it's for internal use.

router.post('/send', notificationController.sendNotification);

module.exports = router;

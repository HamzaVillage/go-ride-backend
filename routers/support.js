const express = require('express');
const router = express.Router();
const supportController = require('../controller/supportController');

router.get('/info', supportController.getContactInfo);
router.post('/message', supportController.sendMessage);

module.exports = router;

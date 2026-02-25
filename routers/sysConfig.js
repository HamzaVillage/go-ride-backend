const express = require('express');
const router = express.Router();
const sysConfigController = require('../controller/sysConfigController');

router.get('/get-config', sysConfigController.getConfig);

module.exports = router;

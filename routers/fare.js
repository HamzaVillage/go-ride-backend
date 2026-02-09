const express = require('express');
const router = express.Router();
const farecalculationController = require('../controller/farecalculationController');

// Calculate fare endpoint (Supports GET and POST)
router.get('/calculate', farecalculationController.calculateFare);
router.post('/calculate', farecalculationController.calculateFare);

module.exports = router;

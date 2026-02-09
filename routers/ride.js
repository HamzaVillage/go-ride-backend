const express = require('express');
const router = express.Router();
const rideController = require('../controller/rideController');
const authMiddleware = require('../utils/authMiddleware');

// Post a new ride (User)
router.post('/create', authMiddleware, rideController.createRide);

// Get nearby rides (Driver)
router.get('/nearby', authMiddleware, rideController.getNearbyRides);

// Bidding System
router.post('/offer', authMiddleware, rideController.makeOffer);
router.get('/offers/:ride_id', authMiddleware, rideController.getOffers);
router.post('/accept-offer', authMiddleware, rideController.acceptOffer);

module.exports = router;

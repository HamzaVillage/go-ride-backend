const express = require('express');
const router = express.Router();
const rideController = require('../controller/rideController');
const authMiddleware = require('../utils/authMiddleware');

// Post a new ride (User)
router.post('/create', authMiddleware, rideController.createRide);

// Get nearby rides (Driver)
router.get('/nearby', authMiddleware, rideController.getNearbyRides);

// Cancel a ride (User/Driver)
router.post('/cancel', authMiddleware, rideController.cancelRide);

// Accept a ride (Driver)
router.post('/accept', authMiddleware, rideController.acceptRide);

// Mark arrival at pickup (Driver)
router.post('/mark-arrived', authMiddleware, rideController.markArrived);

// Start a ride (Driver)
router.post('/start', authMiddleware, rideController.startRide);

// Complete a ride (Driver)
router.post('/complete', authMiddleware, rideController.completeRide);

// Update ride fare (Rider)
router.post('/update-fare', authMiddleware, rideController.updateFare);

// Submit a review (User/Driver)
router.post('/review', authMiddleware, rideController.submitReview);

// Get driver profile (Driver)
router.get('/driver-profile', authMiddleware, rideController.getDriverProfile);

// Get driver earnings (Driver) - list + summary
router.get('/earnings', authMiddleware, rideController.getDriverEarnings);

// Get recent addresses (User)
router.get('/recent-addresses', authMiddleware, rideController.getRecentAddresses);

// Get ride history (User/Driver)
router.get('/history', authMiddleware, rideController.getRideHistory);

// Get active ride for ride recovery on app restart (User/Driver)
router.get('/active', authMiddleware, rideController.getActiveRide);

module.exports = router;

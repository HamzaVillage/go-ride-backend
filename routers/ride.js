const express = require('express');
const router = express.Router();
const adminAuthMiddleware = require('../utils/chatAdminAuthMiddleware');
const chat = require('../controller/rideChatController');
const rideController = require('../controller/rideController');
const authMiddleware = require('../utils/authMiddleware');

router.get('/chat/reports', adminAuthMiddleware, chat.noStore, chat.reports);
router.get('/chat/reports/:reportId', adminAuthMiddleware, chat.noStore, chat.reportDetail);
router.get('/:rideId/chat', authMiddleware, chat.noStore, chat.enabled, chat.history);
router.post('/:rideId/chat/messages', authMiddleware, chat.noStore, chat.enabled, chat.send);
router.post('/:rideId/chat/report', authMiddleware, chat.noStore, chat.enabled, chat.report);

// Post a new ride (User)
router.post('/create', authMiddleware, rideController.createRide);
router.get('/search/:rideId', authMiddleware, rideController.getSearchStatus);

// Get nearby rides (Driver)
router.get('/nearby-drivers', authMiddleware, rideController.getNearbyDrivers);
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

// Clear overdue (Driver) - after paying dues
router.post('/clear-overdue', authMiddleware, rideController.clearOverdue);

// Get driver earnings (Driver) - list + summary
router.get('/earnings', authMiddleware, rideController.getDriverEarnings);

// Get recent addresses (User)
router.get('/recent-addresses', authMiddleware, rideController.getRecentAddresses);

// Get ride history (User/Driver)
router.get('/history', authMiddleware, rideController.getRideHistory);

// Get active ride for ride recovery on app restart (User/Driver)
router.get('/active', authMiddleware, rideController.getActiveRide);

// Generate a shareable tracking link for a ride (User)
router.post('/share-link', authMiddleware, rideController.generateShareLink);

// Web redirect page for shared tracking links (clickable on WhatsApp/SMS)
router.get('/track/:token', rideController.trackRedirectPage);

// Public ride tracking JSON API (no auth) — used by the app's TrackRideScreen
router.get('/public/:token', rideController.getPublicRideTracking);

module.exports = router;

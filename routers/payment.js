const express = require('express');
const router = express.Router();
const paymentController = require('../controller/paymentController');
const authMiddleware = require('../utils/authMiddleware');

// Initiate JazzCash payment (Card / Mobile Account) - generates HMAC-SHA256 and auto-submitting HTML form
router.post('/jazzcash/initiate', initiateAuthOptional, paymentController.initiateJazzCashPayment);

// JazzCash return callback endpoint (handles POST and GET from JazzCash portal)
router.post('/jazzcash/callback', paymentController.handleJazzCashCallback);
router.get('/jazzcash/callback', paymentController.handleJazzCashCallback);
router.post('/jazzcash/return', paymentController.handleJazzCashCallback);
router.get('/jazzcash/return', paymentController.handleJazzCashCallback);

// JazzCash IPN (Instant Payment Notification) & ITN (Instant Token Notification)
router.post('/jazzcash/ipn', paymentController.handleJazzCashCallback);
router.get('/jazzcash/ipn', paymentController.handleJazzCashCallback);
router.post('/jazzcash/itn', (req, res) => res.status(200).json({ success: true, message: 'ITN received' }));
router.get('/jazzcash/itn', (req, res) => res.status(200).json({ success: true, message: 'ITN received' }));

// Transaction status query
router.get('/jazzcash/status/:txnRefNo', paymentController.getPaymentStatus);

// Optional auth helper: attaches user if token exists, but doesn't block if guest
function initiateAuthOptional(req, res, next) {
    const authHeader = req.headers['authorization'];
    if (authHeader) {
        return authMiddleware(req, res, next);
    }
    next();
}

module.exports = router;

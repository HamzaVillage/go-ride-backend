const express = require('express');
const router = express.Router();
const walletController = require('../controller/walletController');
const authMiddleware = require('../utils/authMiddleware');

// Get wallet balance and overview (Rider)
router.get('/balance', authMiddleware, walletController.getWalletBalance);

// Get paginated transaction history (Rider)
router.get('/transactions', authMiddleware, walletController.getWalletTransactions);

// Initiate wallet top-up via JazzCash (Rider)
router.post('/topup/initiate', authMiddleware, walletController.initiateWalletTopup);

// Verify & complete wallet top-up (Rider)
router.post('/topup/verify', authMiddleware, walletController.verifyWalletTopup);

// Browser callback endpoint for JazzCash return URL
router.post('/topup/callback', walletController.handleTopupCallback);
router.get('/topup/callback', walletController.handleTopupCallback);
router.post('/topup/return', walletController.handleTopupCallback);
router.get('/topup/return', walletController.handleTopupCallback);

// IPN (Instant Payment Notification) & ITN (Instant Token Notification)
router.post('/topup/ipn', walletController.handleTopupCallback);
router.get('/topup/ipn', walletController.handleTopupCallback);
router.post('/topup/itn', (req, res) => res.status(200).json({ success: true, message: 'ITN received' }));
router.get('/topup/itn', (req, res) => res.status(200).json({ success: true, message: 'ITN received' }));

// Direct hosted checkout route
router.get('/topup/checkout/:txnRefNo', walletController.checkoutWalletTopup);

module.exports = router;

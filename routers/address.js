const express = require('express');
const router = express.Router();
const addressController = require('../controller/addressController');
const authMiddleware = require('../utils/authMiddleware');

// Add a new address
router.post('/add', authMiddleware, addressController.addAddress);

// Get all saved addresses
router.get('/all', authMiddleware, addressController.getAddresses);

// Get a single address by ID
router.get('/:id', authMiddleware, addressController.getAddressById);

// Update an address
router.put('/:id', authMiddleware, addressController.updateAddress);

// Delete an address
router.delete('/:id', authMiddleware, addressController.deleteAddress);

module.exports = router;

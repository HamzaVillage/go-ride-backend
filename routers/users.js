const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const userController = require('../controller/userController');
const authMiddleware = require('../utils/authMiddleware');

// Configure Multer Storage
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = process.env.UPLOAD_DIR || 'uploads/';
        try {
            if (!fs.existsSync(uploadDir)) {
                fs.mkdirSync(uploadDir, { recursive: true });
            }
            cb(null, uploadDir);
        } catch (err) {
            console.warn(`⚠️ Access to UPLOAD_DIR '${uploadDir}' failed (${err.message}). Falling back to local 'uploads/'`);
            const fallbackDir = 'uploads/';
            if (!fs.existsSync(fallbackDir)) {
                fs.mkdirSync(fallbackDir, { recursive: true });
            }
            cb(null, fallbackDir);
        }
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, file.fieldname + '_' + uniqueSuffix + ext);
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: (req, file, cb) => {
        const filetypes = /jpeg|jpg|png|webp|avif/;
        const mimetype = filetypes.test(file.mimetype);
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        if (mimetype && extname) {
            return cb(null, true);
        }
        cb(new Error("Error: File upload only supports the following filetypes - " + filetypes));
    }
});

// Protected Profile Routes (Customer)
router.get('/profile', authMiddleware, userController.getProfile);
router.put('/profile', authMiddleware, userController.updateProfile);

// Driver Account Routes
router.get('/driver-account', authMiddleware, userController.getDriverAccount);
router.put('/driver-account', authMiddleware, userController.updateDriverAccount);
router.get('/driver-status', authMiddleware, userController.getDriverStatus);

router.post('/fcm-token', authMiddleware, userController.updateFcmToken);

// Profile Picture Update
router.post('/update-photo', authMiddleware, upload.single('photo'), userController.updateProfilePicture);

// Driver registration public endpoint (no authMiddleware required)
router.post('/driver-register', upload.fields([
    { name: 'Photo', maxCount: 1 },
    { name: 'CNIC_Front', maxCount: 1 },
    { name: 'CNIC_Back', maxCount: 1 },
    { name: 'License', maxCount: 1 }
]), userController.registerDriver);

module.exports = router;

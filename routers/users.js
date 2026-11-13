const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const userController = require('../controller/userController');
const authMiddleware = require('../utils/authMiddleware');

// Configure Multer Storage for local directory
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, '../uploads');
        try {
            if (!fs.existsSync(uploadDir)) {
                fs.mkdirSync(uploadDir, { recursive: true });
            }
            cb(null, uploadDir);
        } catch (err) {
            console.warn(`⚠️ Access to UPLOAD_DIR '${uploadDir}' failed (${err.message}). Falling back to local 'uploads/'`);
            const fallbackDir = path.join(__dirname, '../uploads');
            if (!fs.existsSync(fallbackDir)) {
                fs.mkdirSync(fallbackDir, { recursive: true });
            }
            cb(null, fallbackDir);
        }
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, (file.fieldname || 'file') + '_' + uniqueSuffix + ext);
    }
});

const maxFileSizeMB = parseInt(process.env.MAX_FILE_SIZE_MB, 10) || 50;

const upload = multer({ 
    storage: storage,
    limits: { fileSize: maxFileSizeMB * 1024 * 1024 }, // 50MB limit
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

// Authenticated enrollment reuses only documents owned by the verified personal account.
const enrollment = require('../services/normalDriverEnrollment').createNormalDriverEnrollment(require('../db/Connect_Db'));
const {resolveCityToCityIdentity}=require('../services/cityToCityIdentity');
const {storeDocument,MAX_BYTES}=require('../services/adminDriverDocuments');
const enrollmentIdentity=async(req,res,next)=>{try{req.user=await resolveCityToCityIdentity(require('../db/Connect_Db'),req.user);next();}catch(e){res.status(e.status||500).json({success:false,message:e.status?e.message:'Unable to verify enrollment account.'});}};
router.get('/driver-enrollment',authMiddleware,enrollmentIdentity,async(req,res)=>{try{res.json({success:true,data:await enrollment.options(req.user.userId)});}catch(e){res.status(e.status||500).json({success:false,message:e.status?e.message:'Unable to load enrollment details.'});}});
const enrollmentUpload=multer({storage:multer.memoryStorage(),limits:{files:5,fileSize:MAX_BYTES,fields:20,fieldSize:4096}}).fields(['Photo','CNIC_Front','CNIC_Back','License','Vehicle_Running_Page'].map(name=>({name,maxCount:1})));
router.post('/driver-enrollment',authMiddleware,enrollmentIdentity,(req,res,next)=>enrollmentUpload(req,res,e=>e?res.status(400).json({success:false,message:'Upload up to five images, no larger than 8 MB each.'}):next()),async(req,res)=>{
    const stored=[];let committed=false;
    try{const {DOCS}=require('../services/normalDriverEnrollment'),paths={};for(const [field,files]of Object.entries(req.files||{})){const saved=await storeDocument(files[0],DOCS[field][0]);stored.push(saved);paths[field]=saved.storedPath;}
        const result=await enrollment.enroll(req.user.userId,req.body,paths);committed=true;
        if(result.already_submitted)await Promise.all(stored.map(f=>fs.promises.unlink(f.filePath).catch(()=>{})));
        res.json({success:true,message:'Driver registration request submitted successfully!',...result});
    }catch(e){if(!committed)await Promise.all(stored.map(f=>fs.promises.unlink(f.filePath).catch(()=>{})));res.status(e.status||500).json({success:false,message:e.status?e.message:'Unable to submit enrollment.'});}
});

// Driver registration public endpoint (no authMiddleware required)
router.post('/driver-register', (req,res,next)=>req.headers.authorization?authMiddleware(req,res,()=>enrollmentIdentity(req,res,next)):next(), upload.fields([
    { name: 'Photo', maxCount: 1 },
    { name: 'CNIC_Front', maxCount: 1 },
    { name: 'CNIC_Back', maxCount: 1 },
    { name: 'License', maxCount: 1 },
    { name: 'Vehicle_Running_Page', maxCount: 1 },
    { name: 'Vehicle_Doc', maxCount: 1 }
]), userController.registerDriver);

// On-Demand Silent Live Location Ping & Tracking Routes
router.post('/ping-location/:userId', authMiddleware, userController.pingUserLocation);
router.post('/submit-location', userController.submitLiveLocation);
router.get('/live-location/:userId', authMiddleware, userController.getLatestLocation);

module.exports = router;

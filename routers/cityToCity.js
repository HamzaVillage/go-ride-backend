const express = require('express');
const multer = require('multer');
const fs = require('node:fs/promises');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const FormData = require('form-data');
const auth = require('../utils/authMiddleware');
const { createCityToCityDrivers, DOCUMENT_TYPES, fail } = require('../services/cityToCityDrivers');
const { createCityToCityAuth } = require('../services/cityToCityAuth');
const { resolveCityToCityIdentity } = require('../services/cityToCityIdentity');
const { publishRequest, publishTrip } = require('../services/cityToCityRealtime');
const { createCityToCityDispatch } = require('../services/cityToCityDispatch');
const { createGeography } = require('../services/cityToCityGeography');
const { MAX_BYTES, storeDocument, readDocument } = require('../services/adminDriverDocuments');

function createCityToCityRouter(pool) {
    const router = express.Router(), service = createCityToCityDrivers(pool);
    const dispatch = createCityToCityDispatch(pool,createGeography(pool));
    const sendError = (res, error) => { if (!error.status) console.error('City-to-city request failed:', error.code || 'INTERNAL_ERROR'); res.status(error.status || 500).json({ success: false, code: error.status ? error.code : undefined, message: error.status ? error.message : 'Unable to complete this city-to-city request.' }); };
    const respond = action => async (req, res) => { try { res.json({ success: true, data: await action(req) }); } catch (error) { sendError(res, error); } };
    const login = createCityToCityAuth({ pool,
        sendOtp: async phone => {
            const form = new FormData(); form.append('mobile', phone);
            const response = await axios.post('https://nexuscodelab.com/calling/send_otp.php', form, { headers: form.getHeaders(), timeout: 10000 });
            if (!response.data?.sent || !response.data?.opt) throw fail(502, 'Unable to send verification code.');
            return response.data.opt;
        },
        signToken: claims => { if (!process.env.JWT_SECRET) throw fail(503, 'Sign-in is temporarily unavailable.'); return jwt.sign(claims, process.env.JWT_SECRET, { expiresIn: '30d' }); },
    });
    router.use((_req, res, next) => { res.set('Cache-Control', 'no-store, private'); next(); });
    const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false, message: { success: false, message: 'Too many attempts. Please try again later.' } });
    router.post('/auth/send-otp', limiter, respond(req => login.send(req.body)));
    router.post('/auth/verify-otp', limiter, respond(req => login.verify(req.body)));
    router.get('/services', respond(async () => {
        const [rows] = await pool.query('SELECT id,code,name,description,icon_url,pricing_unit,requires_passenger_count FROM city_to_city_services WHERE is_active=1 ORDER BY sort_order,id');
        return rows;
    }));
    router.use(auth);
    router.use(async (req,res,next) => { try { req.user=await resolveCityToCityIdentity(pool,req.user); next(); } catch(error) { sendError(res,error); } });
    const wallet = require('../services/cityToCityWallet').createCityToCityWallet(pool);
    router.get('/driver/wallet/eligibility',respond(req=>wallet.eligibility(req.user.userId)));
    router.get('/driver/wallet',respond(req=>wallet.mine(req.user.userId,req.query)));
    router.post('/driver/wallet/topups',respond(req=>wallet.submit(req.user.userId,req.body)));
    router.post('/quotes',respond(req=>dispatch.quotes(req.user.userId,req.body)));
    router.post('/quote',respond(req=>dispatch.quote(req.user.userId,req.body)));
    router.post('/requests',respond(async req=>{const result=await dispatch.create(req.user.userId,req.body);await publishRequest(pool,result.id);return result;}));
    router.get('/requests/active',respond(req=>dispatch.active(req.user.userId)));
    router.get('/requests/:id',respond(req=>dispatch.status(req.user.userId,req.params.id)));
    router.post('/requests/:id/cancel',respond(async req=>{const result=await dispatch.cancel(req.user.userId,req.params.id);await publishRequest(pool,result.id);return result;}));
    router.post('/driver/presence',respond(req=>dispatch.presence(req.user.userId,req.body)));
    router.get('/driver/requests',respond(req=>dispatch.requests(req.user.userId)));
    router.post('/driver/requests/:id/accept',respond(async req=>{const result=await dispatch.accept(req.user.userId,req.params.id);await publishRequest(pool,result.id);return result;}));
    router.get('/driver/active-trip',respond(req=>dispatch.driverActive(req.user.userId)));
    router.post('/driver/trips/:id/:action',respond(async req=>{const result=await dispatch.progress(req.user.userId,req.params.id,req.params.action);await publishTrip(pool,result.trip_id);return result;}));
    router.get('/driver/options', respond(req => service.options(req.user.userId)));
    router.get('/driver/account', respond(req => service.account(req.user.userId)));
    router.post('/driver/switch', respond(req => service.switchMode(req.user.userId, req.body?.mode)));
    const parseVehicle = multer({storage:multer.memoryStorage(),limits:{fileSize:MAX_BYTES,files:5,fields:12,fieldSize:2048}}).fields(Object.keys(DOCUMENT_TYPES).map(name=>({name,maxCount:1})));
    const vehicleUpload = action => [
        (req,res,next) => parseVehicle(req,res,error => error ? res.status(400).json({success:false,message:'Upload up to five documents, no larger than 8 MB each.'}) : next()),
        async (req,res) => {
            const stored=[];
            try {
                if(req.files?.Vehicle_Running_Page && String(req.body?.New_Vehicle)!=='1') throw fail(400,'Confirm the new car details with its registration document.');
                const files=req.files || {};
                for(const [field,uploads] of Object.entries(files)) {
                    const saved=await storeDocument(uploads[0],DOCUMENT_TYPES[field]);
                    uploads[0].storedPath=saved.storedPath;stored.push(saved);
                }
                const data=await action(req,files);
                if(data.already_submitted) await Promise.all(stored.map(file=>fs.unlink(file.filePath).catch(()=>{})));
                res.json({success:true,data});
            }catch(error){if(error.status && error.status<500) await Promise.all(stored.map(file=>fs.unlink(file.filePath).catch(()=>{})));sendError(res,error);}
        }
    ];
    router.post('/driver/capacity',...vehicleUpload((req,files)=>service.updateCapacity(req.user.userId,req.body,files)));
    router.post('/driver/enroll-existing',...vehicleUpload((req,files)=>service.enrollExisting(req.user.userId,req.body,files)));
    const parse = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 5, fields: 25, fieldSize: 2048 } }).fields(Object.keys(DOCUMENT_TYPES).map(name => ({ name, maxCount: 1 })));
    router.post('/driver/register', (req, res, next) => parse(req, res, error => error ? res.status(400).json({ success: false, message: 'Upload up to five documents, no larger than 8 MB each.' }) : next()), async (req, res) => {
        const stored = [];
        try {
            for (const [field, files] of Object.entries(req.files || {})) {
                const saved = await storeDocument(files[0], DOCUMENT_TYPES[field]);
                files[0].storedPath = saved.storedPath; stored.push(saved);
            }
            const data = await service.register(req.user.userId, req.body, req.files);
            if (data.already_submitted) await Promise.all(stored.map(file => fs.unlink(file.filePath).catch(() => {})));
            res.json({ success: true, data });
        } catch (error) {
            // Keep uploads after uncertain DB errors; delete only on definite validation rejection.
            if (error.status && error.status < 500) await Promise.all(stored.map(file => fs.unlink(file.filePath).catch(() => {})));
            sendError(res, error);
        }
    });
    router.get('/driver/documents/:id', async (req, res) => {
        try {
            const [rows] = await pool.query('SELECT doc.file_key FROM city_to_city_driver_documents doc JOIN city_to_city_drivers d ON d.id=doc.city_to_city_driver_id WHERE doc.id=? AND d.user_id=?', [req.params.id,req.user.userId]);
            if (!rows.length) throw fail(404, 'Document not found.');
            const file = await readDocument(rows[0].file_key);
            res.set({ 'Content-Type': file.mime, 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" }).send(file.buffer);
        } catch (error) { sendError(res, error); }
    });
    return router;
}
module.exports = { createCityToCityRouter };

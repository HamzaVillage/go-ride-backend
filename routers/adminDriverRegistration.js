const express = require('express');
const multer = require('multer');
const { MAX_BYTES } = require('../services/adminDriverDocuments');
const { DOCUMENT_TYPES } = require('../services/cityToCityDrivers');
const { createAdminDriverRegistration } = require('../services/adminDriverRegistration');
function createDriverRegistrationRouter(pool, kind) {
    const router = express.Router(), service = createAdminDriverRegistration(pool);
    const respond = action => async (req,res) => {
        try { res.json({ success:true, data:await action(req) }); }
        catch (err) { if (!err.status) console.error('Driver registration failed:',err.code || 'INTERNAL_ERROR'); res.status(err.status || 500).json({ success:false,message:err.status ? err.message : 'Unable to register driver. Retry with the same request details.' }); }
    };
    const parse = multer({ storage:multer.memoryStorage(),limits:{ fileSize:MAX_BYTES,files:5,fields:1,fieldSize:16000 } }).fields(Object.keys(DOCUMENT_TYPES).map(name => ({ name,maxCount:1 })));
    router.get('/registration-options',respond(req => service.options(req.user.employeeId,kind)));
    router.post('/',(req,res,next) => {
        if (!req.is('multipart/form-data')) return next();
        parse(req,res,error => error ? res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ success:false,message:'Upload up to five documents, maximum 8 MB each.' }) : next());
    },respond(req => {
        let body = req.body;
        if (req.is('multipart/form-data')) {
            try { body = JSON.parse(req.body.payload); } catch { throw Object.assign(new Error('Invalid registration details.'),{ status:400 }); }
        }
        return service.create(req.user.employeeId,kind,body,req.files);
    }));
    return router;
}
module.exports = { createDriverRegistrationRouter };

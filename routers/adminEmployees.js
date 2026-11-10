const express = require('express');
const multer = require('multer');
const fs = require('node:fs/promises');
const path = require('node:path');
const { fail } = require('../services/employeeAccess');
const { createEmployeeService, DOC_KEYS } = require('../services/adminEmployees');
const { MAX_BYTES, storeDocument, readDocument } = require('../services/adminDriverDocuments');
function locations() {
    const privateRoot = path.resolve(process.env.EMPLOYEE_DOCUMENT_DIR || path.join(__dirname, '../private_uploads/employee-documents'));
    const publicRoot = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '../uploads'));
    if (privateRoot === publicRoot || privateRoot.startsWith(publicRoot + path.sep)) throw fail(503, 'Employee document storage must be outside the public uploads directory.');
    return { privateRoot };
}
function createEmployeeRouter(pool) {
    const router = express.Router(); const service = createEmployeeService(pool);
    const error = (res, err) => {
        if (!err.status) console.error('Employee request failed:', err.code || 'INTERNAL_ERROR');
        return res.status(err.status || 500).json({ success: false, message: err.status ? err.message : 'Unable to complete this employee request.' });
    };
    const respond = action => async (req, res) => { try { res.json({ success: true, data: await action(req) }); } catch (err) { error(res, err); } };
    router.get('/', respond(req => service.list(req.query)));
    router.get('/catalog', respond(() => service.catalog()));
    router.post('/roles', respond(req => service.saveRole(null, req.user.userId, req.body)));
    router.patch('/roles/:id', respond(req => service.saveRole(req.params.id, req.user.userId, req.body)));
    router.patch('/functions/:id', respond(req => service.saveFunction(req.params.id, req.user.userId, req.body)));
    router.post('/', respond(req => service.saveEmployee(null, req.user.userId, req.body)));
    router.get('/:id', respond(req => service.detail(req.params.id)));
    router.patch('/:id', respond(req => service.saveEmployee(req.params.id, req.user.userId, req.body)));
    router.get('/:id/documents/:key', async (req, res) => {
        try {
            const source = await service.documentSource(req.params.id, req.params.key);
            const file = await readDocument(source, { locations: locations() });
            res.set({ 'Content-Type': file.mime, 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox", 'Content-Disposition': `inline; filename="employee-document${file.ext}"` });
            res.send(file.buffer);
        } catch (err) { error(res, err); }
    });
    const parse = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 1, fields: 1, fieldSize: 100 } }).single('document');
    router.post('/:id/documents/:key', (req, res, next) => {
        if (!DOC_KEYS.includes(req.params.key)) return res.status(400).json({ success: false, message: 'Unknown document type.' });
        parse(req, res, err => err ? res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ success: false, message: 'Upload one image or PDF, up to 8 MB, with the current employee version.' }) : next());
    }, async (req, res) => {
        let stored;
        try {
            stored = await storeDocument(req.file, req.params.key, { locations: locations() });
            const data = await service.attachDocument(req.params.id, req.user.userId, req.params.key, Number(req.body.version), stored.storedPath);
            res.json({ success: true, data });
        } catch (err) {
            if (stored && err.status && err.status < 500) await fs.unlink(stored.filePath).catch(() => {});
            error(res, err);
        }
    });
    return router;
}
module.exports = { createEmployeeRouter };

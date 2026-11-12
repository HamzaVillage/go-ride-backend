const express = require('express');
const { createAdminCityToCityDrivers } = require('../services/adminCityToCityDrivers');
const { readDocument } = require('../services/adminDriverDocuments');
function createAdminCityToCityRouter(pool) {
    const router = express.Router(), service = createAdminCityToCityDrivers(pool);
    const error = (res, err) => { if (!err.status) console.error('City-to-city admin request failed:', err.code || 'INTERNAL_ERROR'); res.status(err.status || 500).json({ success: false, message: err.status ? err.message : 'Unable to complete this review.' }); };
    const respond = action => async (req, res) => { try { res.json({ success: true, data: await action(req) }); } catch (err) { error(res, err); } };
    router.get('/', respond(req => service.list(req.query)));
    router.get('/:id', respond(req => service.detail(req.params.id)));
    router.patch('/:id/status', respond(req => service.review(req.params.id, req.user.employeeId, req.body)));
    router.patch('/:id/imported-details', respond(req => service.completeImported(req.params.id,req.user.employeeId,req.body)));
    router.get('/:id/documents/:documentId', async (req, res) => {
        try { const source = await service.document(req.params.id, req.params.documentId); const file = await readDocument(source); res.set({ 'Content-Type': file.mime, 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" }).send(file.buffer); }
        catch (err) { error(res, err); }
    });
    return router;
}
module.exports = { createAdminCityToCityRouter };

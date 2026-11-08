const express = require('express');
const { createDriverProfileRouter } = require('./adminDriverProfiles');
const adminSession = require('../utils/adminSessionMiddleware');
const { createAdminDriversService } = require('../services/adminDrivers');
const { createAdminOverviewService } = require('../services/adminOverview');
function createAdminRouter(pool) {
    const router = express.Router(); const service = createAdminDriversService(pool);
    const overview = createAdminOverviewService(pool);
    router.use((req, res, next) => { res.set('Cache-Control', 'no-store, private'); next(); }, adminSession);
    const respond = action => async (req, res) => {
        try { res.json({ success:true, data:await action(req) }); }
        catch (err) {
            if (!err.status) console.error('Admin request failed:', err.code || 'INTERNAL_ERROR');
            res.status(err.status || 500).json({ success:false, message:err.status ? err.message : 'Unable to complete this request. Please try again.' });
        }
    };
    router.use('/drivers', createDriverProfileRouter(pool));
    router.get('/drivers', respond(req => service.list(req.query)));
    router.get('/overview', respond(req => overview.get(req.query)));
    router.get('/drivers/:driverId/wallet', respond(req => service.wallet(req.params.driverId, req.query)));
    router.post('/drivers/:driverId/topups', respond(req => service.topup(req.params.driverId, req.user.userId, req.body, req.get('Idempotency-Key'))));
    return router;
}
module.exports = { createAdminRouter };

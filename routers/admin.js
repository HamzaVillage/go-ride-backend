const express = require('express');
const { createSettingsRouter } = require('./adminSettings');
const { createAccessMiddleware } = require('../services/employeeAccess');
const { createEmployeeRouter } = require('./adminEmployees');
const { createAdminFranchisesService } = require('../services/adminFranchises');
const { createAdminDirectoriesService } = require('../services/adminDirectories');
const { createDriverProfileRouter } = require('./adminDriverProfiles');
const adminSession = require('../utils/adminSessionMiddleware');
const { createAdminDriversService } = require('../services/adminDrivers');
const { createAdminOverviewService } = require('../services/adminOverview');
function createAdminRouter(pool, { backup } = {}) {
    const router = express.Router(); const service = createAdminDriversService(pool);
    const overview = createAdminOverviewService(pool);
    const directories = createAdminDirectoriesService(pool);
    const franchises = createAdminFranchisesService(pool);
    router.use((req, res, next) => { res.set('Cache-Control', 'no-store, private'); next(); }, adminSession);
    const respond = action => async (req, res) => {
        try { res.json({ success:true, data:await action(req) }); }
        catch (err) {
            if (!err.status) console.error('Admin request failed:', err.code || 'INTERNAL_ERROR');
            res.status(err.status || 500).json({ success:false, message:err.status ? err.message : 'Unable to complete this request. Please try again.' });
        }
    };
    router.get('/me', createAccessMiddleware(pool), respond(req => req.access));
    router.use('/employees', createAccessMiddleware(pool, 'employees'), createEmployeeRouter(pool));
    router.use((req, res, next) => {
        const screen = { drivers: 'drivers', overview: 'overview', rides: 'rides', riders: 'riders', franchises: 'franchises', support: 'support', settings: 'settings' }[req.path.split('/')[1]];
        if (!screen) return res.status(404).json({ success: false, message: 'Unknown admin endpoint.' });
        return createAccessMiddleware(pool, screen)(req, res, next);
    });
    router.use('/settings', createSettingsRouter(pool, { backup }));
    router.use('/drivers', createDriverProfileRouter(pool));
    router.get('/drivers', respond(req => service.list(req.query)));
    router.get('/franchises', respond(req => franchises.list(req.query)));
    router.get('/franchises/:id', respond(req => franchises.get(req.params.id)));
    router.get('/rides', respond(req => directories.rides(req.query)));
    router.get('/riders', respond(req => directories.riders(req.query)));
    router.get('/support', respond(req => directories.support(req.query)));
    router.get('/overview', respond(req => overview.get(req.query)));
    router.get('/drivers/:driverId/wallet', respond(req => service.wallet(req.params.driverId, req.query)));
    router.post('/drivers/:driverId/topups', respond(req => service.topup(req.params.driverId, req.user.userId, req.body, req.get('Idempotency-Key'))));
    return router;
}
module.exports = { createAdminRouter };

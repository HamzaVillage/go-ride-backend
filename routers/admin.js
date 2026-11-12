const express = require('express');
const { createSettingsRouter } = require('./adminSettings');
const { createAccessMiddleware } = require('../services/employeeAccess');
const { createEmployeeRouter } = require('./adminEmployees');
const { createAdminFranchisesService } = require('../services/adminFranchises');
const { createAdminDirectoriesService } = require('../services/adminDirectories');
const { createDriverProfileRouter } = require('./adminDriverProfiles');
const { createAdminCityToCityRouter } = require('./adminCityToCityDrivers');
const { createAdminCityToCitySettings } = require('../services/adminCityToCitySettings');
const { createAdminFranchiseMembers } = require('../services/adminFranchiseMembers');
const { createAdminRiderProfiles } = require('../services/adminRiderProfiles');
const adminSession = require('../utils/adminSessionMiddleware');
const { createAdminDriversService } = require('../services/adminDrivers');
const { createAdminOverviewService } = require('../services/adminOverview');
function createAdminRouter(pool, { backup } = {}) {
    const router = express.Router(); const service = createAdminDriversService(pool);
    const overview = createAdminOverviewService(pool);
    const directories = createAdminDirectoriesService(pool);
    const franchises = createAdminFranchisesService(pool);
    const riderProfiles = createAdminRiderProfiles(pool);
    const intercity = createAdminCityToCitySettings(pool), members = createAdminFranchiseMembers(pool);
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
        const screen = { 'city-to-city-drivers': 'city_to_city_drivers', 'city-to-city-fares': 'city_to_city_fares', 'city-to-city-routes': 'city_to_city_routes', 'city-to-city-calculator': 'city_to_city_calculator', 'franchise-members': 'franchise_members', drivers: 'drivers', overview: 'overview', rides: 'rides', riders: 'riders', franchises: 'franchises', support: 'support', settings: 'settings' }[req.path.split('/')[1]];
        if (!screen) return res.status(404).json({ success: false, message: 'Unknown admin endpoint.' });
        return createAccessMiddleware(pool, screen)(req, res, next);
    });
    router.get('/city-to-city-fares', respond(() => intercity.services()));
    router.patch('/city-to-city-fares/:id', respond(req => intercity.save('services',req.params.id,req.user.employeeId,req.body)));
    router.get('/city-to-city-routes', respond(() => intercity.routes()));
    router.post('/city-to-city-routes', respond(req => intercity.createRoute(req.user.employeeId,req.body)));
    router.patch('/city-to-city-routes/:id', respond(req => intercity.save('routes',req.params.id,req.user.employeeId,req.body)));
    router.get('/city-to-city-calculator', respond(async () => ({...(await intercity.routes()),services:await intercity.services()})));
    router.post('/city-to-city-calculator', respond(req => intercity.preview(req.body)));
    router.get('/franchise-members', respond(req => members.list(req.user.employeeId,req.query)));
    router.post('/franchise-members', respond(req => members.create(req.user.employeeId,req.body)));
    router.put('/franchise-members/scope', respond(req => members.assign(req.user.employeeId,req.body)));
    router.use('/settings', createSettingsRouter(pool, { backup }));
    router.use('/drivers', createDriverProfileRouter(pool));
    router.use('/city-to-city-drivers', createAdminCityToCityRouter(pool));
    router.get('/drivers', respond(req => service.list(req.query)));
    router.get('/franchises', respond(req => franchises.list(req.query)));
    router.patch('/franchises/:id', respond(req => franchises.update(req.params.id,req.user.employeeId,req.body)));
    router.get('/riders/:id', respond(req => riderProfiles.detail(req.params.id)));
    router.patch('/riders/:id', respond(req => riderProfiles.update(req.params.id,req.user.employeeId,req.body)));
    router.get('/franchises/:id', respond(req => franchises.get(req.params.id)));
    router.get('/rides', respond(req => directories.rides(req.query)));
    router.get('/riders', respond(req => directories.riders(req.query)));
    router.get('/support', respond(req => directories.support(req.query)));
    router.get('/overview', respond(req => overview.get(req.query)));
    router.get('/drivers/:driverId/wallet', respond(req => service.wallet(req.params.driverId, req.query)));
    router.post('/drivers/:driverId/topups', respond(req => service.topup(req.params.driverId, req.user.employeeId, req.body, req.get('Idempotency-Key'))));
    return router;
}
module.exports = { createAdminRouter };

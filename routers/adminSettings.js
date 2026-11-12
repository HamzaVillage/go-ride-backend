const express = require('express');
const { createAdminSettings } = require('../services/adminSettings');
const { createDatabaseBackup } = require('../services/databaseBackup');
function createSettingsRouter(pool, { backup = createDatabaseBackup({ pool }) } = {}) {
    const router = express.Router(), settings = createAdminSettings(pool);
    const error = (res, err) => {
        if (!err.status) console.error('Admin settings request failed:', err.code || 'INTERNAL_ERROR');
        if (res.headersSent || res.destroyed) return;
        res.status(err.status || 500).json({ success: false, message: err.status ? err.message : 'Unable to complete this settings request.' });
    };
    const respond = handler => async (req, res) => { try { res.json({ success: true, data: await handler(req) }); } catch (err) { error(res, err); } };
    const rootOnly = async (req, res, next) => {
        try {
            if (!req.access?.is_super_admin || req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Whole-database backups require a super administrator.' });
            const [rows] = await pool.query("SELECT emp_id FROM employee WHERE emp_id = ? AND account_type = 'superadmin' AND is_active = 1 AND is_deleted = 0", [req.user.employeeId]);
            if (!rows.length) return res.status(401).json({ success: false, message: 'An active administrator is required.' });
            next();
        } catch (err) { error(res, err); }
    };
    router.get('/', respond(() => settings.get()));
    router.patch('/', respond(req => settings.update(req.user.employeeId, req.body)));
    router.post('/fare-preview', respond(req => settings.preview(req.body)));
    router.get('/backup/status', rootOnly, respond(() => backup.status()));
    router.post('/backup', rootOnly, async (req, res) => {
        const controller = new AbortController();
        const disconnected = () => { if (!res.writableFinished) controller.abort(); };
        req.on('aborted', disconnected); res.on('close', disconnected);
        let file;
        try {
            file = await backup.generate({ signal: controller.signal });
            if (controller.signal.aborted) return;
            console.info('Database backup prepared', { adminId: req.user.employeeId, bytes: file.size, snapshotMode: file.snapshot_mode });
            res.set({ 'Content-Type': 'application/gzip', 'Content-Length': String(file.size), 'X-Content-Type-Options': 'nosniff', 'X-Accel-Buffering': 'no', 'Access-Control-Expose-Headers': 'Content-Disposition, Content-Length' });
            await new Promise((resolve, reject) => res.download(file.filePath, file.filename, err => err ? reject(err) : resolve()));
        } catch (err) { if (!controller.signal.aborted) error(res, err); }
        finally { req.off('aborted', disconnected); res.off('close', disconnected); await file?.cleanup().catch(() => {}); }
    });
    return router;
}
module.exports = { createSettingsRouter };

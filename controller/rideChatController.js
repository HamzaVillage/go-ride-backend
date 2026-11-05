const pool = require('../db/Connect_Db');
const { getIO } = require('../socket/socketManager');
const { createRideChatService, isChatEnabled } = require('../services/rideChatService');
const { notifyCustomer, notifyDriver } = require('../services/pushNotificationService');
const chat = createRideChatService(pool);
const fail = (res, err) => res.status(err.status || 500).json({ success: false,
    code: err.code || 'CHAT_ERROR', message: err.status ? err.message : 'Chat is temporarily unavailable.' });
const enabled = (req, res, next) => isChatEnabled() ? next() : res.status(503).json({ success: false, code: 'CHAT_DISABLED', message: 'Chat is not enabled yet.' });
module.exports = {
    noStore: (req, res, next) => { res.set('Cache-Control', 'no-store, private'); next(); },
    enabled,
    history: async (req, res) => {
        try { res.json({ success: true, ...await chat.history(req.params.rideId, req.user) }); }
        catch (err) { fail(res, err); }
    },
    send: async (req, res) => {
        try {
            const result = await chat.send(req.params.rideId, req.user, req.body);
            if (!result.duplicate) {
                try { getIO().to(`chat:${result.ride_id}`).emit('ride_chat:message', { ride_id: result.ride_id, message: result.message }); }
                catch (err) { console.warn('Chat realtime delivery failed:', err.code || 'ERROR'); }
                const notify = result.recipient.type === 'driver' ? notifyDriver : notifyCustomer;
                const title = result.message.sender_role === 'driver' ? 'New message from your driver' : 'New message from your customer';
                // Keep message contents out of push-provider history and lock screens.
                void notify(result.recipient.id, title, 'Open your active ride chat to read it.', {
                    event: 'ride_chat_message', ride_id: result.ride_id, message_id: result.message.id,
                }).catch(() => console.warn('Chat push delivery failed'));
            }
            res.json({ success: true, ride_id: result.ride_id, message: result.message });
        } catch (err) { fail(res, err); }
    },
    reports: async (req, res) => {
        let conn;
        try {
            conn = await pool.getConnection();
            const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
            const [rows] = await conn.query('SELECT id, ride_id, reporter_user_id, reporter_role, reason, review_status, created_at FROM reported_Chat ORDER BY id DESC LIMIT ?', [limit]);
            res.json({ success: true, data: rows });
        } catch (err) { fail(res, err); }
        finally { if (conn) conn.release(); }
    },
    reportDetail: async (req, res) => {
        let conn;
        try {
            conn = await pool.getConnection();
            const [rows] = await conn.query('SELECT * FROM reported_Chat WHERE id = ?', [req.params.reportId]);
            if (!rows.length) return res.status(404).json({ success: false, message: 'Report not found.' });
            res.json({ success: true, data: rows[0] });
        } catch (err) { fail(res, err); }
        finally { if (conn) conn.release(); }
    },
    report: async (req, res) => {
        try { res.json({ success: true, ...await chat.report(req.params.rideId, req.user, req.body?.reason) }); }
        catch (err) { fail(res, err); }
    },
};

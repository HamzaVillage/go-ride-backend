const ACTIVE_CHAT_STATES = new Set(['Accepted', 'Arrived', 'Started']);
const CHAT_LIMIT = 500;
const isChatEnabled = () => process.env.RIDE_CHAT_ENABLED === 'true';
function chatError(status, code, message) {
    return Object.assign(new Error(message), { status, code });
}
const safeId = value => /^[1-9]\d*$/.test(String(value || ''));
function messageDto(row) {
    return { id: String(row.id), client_message_id: row.client_message_id, sender_role: row.sender_role,
        text: row.message_text, created_at: row.created_at };
}
function createRideChatService(pool, { enabled = isChatEnabled } = {}) {
    async function transaction(action) {
        if (!(typeof enabled === 'function' ? enabled() : enabled)) throw chatError(503, 'CHAT_DISABLED', 'Chat is not enabled yet.');
        const conn = await pool.getConnection();
        let open = false;
        let usable = true;
        try {
            await conn.beginTransaction(); open = true;
            const result = await action(conn);
            await conn.commit(); open = false;
            return result;
        } finally {
            try { if (open) await conn.rollback(); }
            catch { usable = false; conn.destroy(); }
            finally { if (usable) conn.release(); }
        }
    }
    async function authorize(conn, rideId, user) {
        if (!(typeof enabled === 'function' ? enabled() : enabled)) throw chatError(503, 'CHAT_DISABLED', 'Chat is not enabled yet.');
        if (!safeId(rideId)) throw chatError(400, 'INVALID_RIDE', 'Invalid ride.');
        const [rows] = await conn.query(
            `SELECT Ride_ID_Pk, User_ID_FK AS customer_id, Driver_ID_Fk AS driver_id, Ride_Status
             FROM ride_history WHERE Ride_ID_Pk = ? FOR UPDATE`, [rideId]
        );
        const ride = rows[0];
        if (!ride) throw chatError(404, 'RIDE_NOT_FOUND', 'Ride not found.');
        let role;
        if (String(ride.customer_id) === String(user.userId)) role = 'customer';
        else if (ride.driver_id != null) {
            const [drivers] = await conn.query(
                `SELECT id FROM drivers WHERE id = ? AND (User_ID_FK = ? OR
                 (? <> '' AND REPLACE(phone, '-', '') = REPLACE(?, '-', '')))`, [ride.driver_id, user.userId, user.phone || '', user.phone || '']
            );
            if (drivers.length) role = 'driver';
        }
        if (!role) throw chatError(403, 'CHAT_FORBIDDEN', 'Only this ride’s customer and assigned driver can access chat.');
        if (!ACTIVE_CHAT_STATES.has(ride.Ride_Status) || !ride.driver_id) {
            throw chatError(410, 'CHAT_CLOSED', 'Chat is available only during an accepted, active ride.');
        }
        return { ride, role };
    }
    async function history(rideId, user) {
        return transaction(async conn => {
            const { role } = await authorize(conn, rideId, user);
            const [rows] = await conn.query('SELECT * FROM ride_chat_messages WHERE ride_id = ? ORDER BY id ASC LIMIT 500', [rideId]);
            return { ride_id: String(rideId), my_role: role, messages: rows.map(messageDto) };
        });
    }
    async function send(rideId, user, input = {}) {
        const text = typeof input?.text === 'string' ? input.text.trim() : '';
        const clientId = input?.client_message_id;
        if (!text || text.length > 1000 || typeof clientId !== 'string' || !/^[a-zA-Z0-9_-]{8,64}$/.test(clientId)) {
            throw chatError(400, 'INVALID_MESSAGE', 'Enter a message of 1–1000 characters with a valid message ID.');
        }
        return transaction(async conn => {
            const { ride, role } = await authorize(conn, rideId, user);
            const [existing] = await conn.query(
                'SELECT * FROM ride_chat_messages WHERE ride_id = ? AND sender_user_id = ? AND client_message_id = ?',
                [rideId, user.userId, clientId]
            );
            if (existing.length) return { duplicate: true, message: messageDto(existing[0]), ride_id: String(rideId) };
            const [stats] = await conn.query(
                `SELECT COUNT(*) AS total, MAX(CASE WHEN sender_user_id = ? THEN created_at END) AS last_sent,
                 TIMESTAMPDIFF(MICROSECOND, MAX(CASE WHEN sender_user_id = ? THEN created_at END), NOW(3)) AS elapsed_us
                 FROM ride_chat_messages WHERE ride_id = ?`, [user.userId, user.userId, rideId]
            );
            if (Number(stats[0]?.total) >= CHAT_LIMIT) throw chatError(429, 'CHAT_LIMIT', 'This ride’s message limit has been reached.');
            if (stats[0]?.elapsed_us != null && Number(stats[0].elapsed_us) < 1000000) throw chatError(429, 'CHAT_RATE_LIMIT', 'Please wait a moment before sending another message.');
            const [insert] = await conn.query(
                `INSERT INTO ride_chat_messages (ride_id, sender_user_id, sender_role, client_message_id, message_text)
                 VALUES (?, ?, ?, ?, ?)`, [rideId, user.userId, role, clientId, text]
            );
            const [rows] = await conn.query('SELECT * FROM ride_chat_messages WHERE id = ?', [insert.insertId]);
            const message = messageDto(rows[0]);
            // Serialize with reporting and ride closure via the same ride row lock.
            // Reported conversations retain later messages through the end of the ride.
            await conn.query('UPDATE reported_Chat SET transcript = JSON_ARRAY_APPEND(transcript, \'$\', JSON_EXTRACT(?, \'$\')) WHERE ride_id = ?', [JSON.stringify(message), rideId]);
            return { duplicate: false, ride_id: String(rideId), message,
                recipient: role === 'customer' ? { type: 'driver', id: ride.driver_id } : { type: 'customer', id: ride.customer_id } };
        });
    }
    async function report(rideId, user, reason) {
        if (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 1000) throw chatError(400, 'INVALID_REPORT', 'Enter a report reason of 1–1000 characters.');
        return transaction(async conn => {
            const { role } = await authorize(conn, rideId, user);
            const [existing] = await conn.query('SELECT id FROM reported_Chat WHERE ride_id = ? AND reporter_user_id = ?', [rideId, user.userId]);
            if (existing.length) return { report_id: String(existing[0].id), already_reported: true };
            const [rows] = await conn.query('SELECT * FROM ride_chat_messages WHERE ride_id = ? ORDER BY id ASC LIMIT 500', [rideId]);
            if (!rows.length) throw chatError(400, 'EMPTY_CHAT', 'There are no chat messages to report yet.');
            const [insert] = await conn.query(
                'INSERT INTO reported_Chat (ride_id, reporter_user_id, reporter_role, reason, transcript) VALUES (?, ?, ?, ?, ?)',
                [rideId, user.userId, role, reason.trim(), JSON.stringify(rows.map(messageDto))]
            );
            return { report_id: String(insert.insertId), already_reported: false };
        });
    }
    return { history, send, report };
}
async function deleteRideChat(conn, rideId) {
    try { await conn.query('DELETE FROM ride_chat_messages WHERE ride_id = ?', [rideId]); }
    catch (err) {
        if (isChatEnabled() || err.code !== 'ER_NO_SUCH_TABLE') throw err;
    }
}
function closeChatRoom(io, rideId) {
    if (!isChatEnabled()) return;
    const room = `chat:${rideId}`;
    io.to(room).emit('ride_chat:closed', { ride_id: String(rideId) });
    io.in(room).socketsLeave(room);
}
// Recover deletion after restarts or when an older backend closed the ride.
function startChatCleanup(pool) {
    let timer;
    let stopped = false;
    async function run() {
        let conn;
        try {
            conn = await pool.getConnection();
            await conn.query(`DELETE m FROM ride_chat_messages m LEFT JOIN ride_history r ON r.Ride_ID_Pk = m.ride_id
                WHERE r.Ride_ID_Pk IS NULL OR r.Ride_Status NOT IN ('Accepted','Arrived','Started')`);
        } catch (err) { if (isChatEnabled() || err.code !== 'ER_NO_SUCH_TABLE') console.error('Chat cleanup failed:', err.code || 'ERROR'); }
        finally { if (conn) conn.release(); if (!stopped) { timer = setTimeout(run, 60000); timer.unref(); } }
    }
    timer = setTimeout(run, 0); timer.unref();
    return () => { stopped = true; clearTimeout(timer); };
}
module.exports = { createRideChatService, deleteRideChat, closeChatRoom, startChatCleanup, ACTIVE_CHAT_STATES, isChatEnabled };

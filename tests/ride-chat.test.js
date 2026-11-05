const test = require('node:test');
const assert = require('node:assert/strict');
const { createRideChatService, deleteRideChat } = require('../services/rideChatService');

// Transactional DB double: all chat/report/end operations lock the same ride.
// No production DB, FCM delivery or external service is accessed by these tests.
function fixture() {
    let state = { ride: { Ride_ID_Pk: 1, customer_id: 99, driver_id: 10, Ride_Status: 'Accepted' }, messages: [], reports: [] };
    let tail = Promise.resolve();
    let now = Date.now();
    let failure = null;
    let openConnections = 0;
    const pool = { async getConnection() {
        openConnections++;
        let local = null;
        let unlock;
        let active = false;
        return {
            async beginTransaction() { active = true; },
            async commit() { if (local) state = local; active = false; unlock?.(); unlock = null; },
            async rollback() { active = false; unlock?.(); unlock = null; },
            release() { assert.equal(active, false); openConnections--; },
            destroy() { active = false; unlock?.(); openConnections--; },
            async query(sql, args = []) {
                if (sql.includes('FROM ride_history') && sql.includes('FOR UPDATE')) {
                    const previous = tail;
                    tail = new Promise(resolve => { unlock = resolve; });
                    await previous;
                    local = structuredClone(state);
                    return [String(args[0]) === '1' ? [local.ride] : []];
                }
                assert.ok(active && local, 'must authorize and lock the ride before accessing chat data');
                if (failure && sql.startsWith(failure)) throw new Error('Injected database failure');
                if (sql.includes('FROM drivers')) return [[10 === Number(args[0]) && (Number(args[1]) === 10 || (args[2] && args[2] === 'driver-phone')) ? { id: 10 } : null].filter(Boolean)];
                if (sql.startsWith('SELECT COUNT')) {
                    const own = local.messages.filter(m => m.sender_user_id === args[0]);
                    return [[{ total: local.messages.length, elapsed_us: own.length ? (now - new Date(own.at(-1).created_at).getTime()) * 1000 : null }]];
                }
                if (sql.startsWith('SELECT * FROM ride_chat_messages')) {
                    if (sql.includes('WHERE id =')) return [local.messages.filter(m => m.id === args[0])];
                    if (sql.includes('client_message_id =')) return [local.messages.filter(m => m.ride_id === Number(args[0]) && m.sender_user_id === args[1] && m.client_message_id === args[2])];
                    return [local.messages.filter(m => m.ride_id === Number(args[0]))];
                }
                if (sql.startsWith('INSERT INTO ride_chat_messages')) {
                    const id = local.messages.length + 1;
                    local.messages.push({ id, ride_id: Number(args[0]), sender_user_id: args[1], sender_role: args[2], client_message_id: args[3], message_text: args[4], created_at: new Date(now).toISOString() });
                    return [{ insertId: id }];
                }
                if (sql.startsWith('UPDATE reported_Chat')) {
                    for (const report of local.reports) if (report.ride_id === Number(args[1])) report.transcript.push(JSON.parse(args[0]));
                    return [{ affectedRows: local.reports.length }];
                }
                if (sql.startsWith('SELECT id FROM reported_Chat')) return [local.reports.filter(r => r.ride_id === Number(args[0]) && r.reporter_user_id === args[1])];
                if (sql.startsWith('INSERT INTO reported_Chat')) {
                    const id = local.reports.length + 1;
                    local.reports.push({ id, ride_id: Number(args[0]), reporter_user_id: args[1], reporter_role: args[2], reason: args[3], transcript: JSON.parse(args[4]) });
                    return [{ insertId: id }];
                }
                if (sql.startsWith('UPDATE ride_history')) { local.ride.Ride_Status = sql.includes('Completed') ? 'Completed' : 'Cancelled'; return [{ affectedRows: 1 }]; }
                if (sql.startsWith('DELETE FROM ride_chat_messages')) { local.messages = []; return [{ affectedRows: 1 }]; }
                throw new Error(`Unexpected query: ${sql}`);
            },
        };
    } };
    const chat = createRideChatService(pool, { enabled: true });
    const customer = { userId: 99, role: 'rider', phone: 'customer-phone' };
    const driver = { userId: 10, role: 'driver', phone: 'driver-phone' };
    async function end(status = 'Completed') {
        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();
            await conn.query('SELECT * FROM ride_history WHERE Ride_ID_Pk = ? FOR UPDATE', [1]);
            await conn.query(`UPDATE ride_history SET Ride_Status = '${status}' WHERE Ride_ID_Pk = ?`, [1]);
            await deleteRideChat(conn, 1);
            await conn.commit();
        } catch (err) { await conn.rollback(); throw err; }
        finally { conn.release(); }
    }
    return { pool, chat, customer, driver, end, state: () => state, advance: () => { now += 1500; }, fail: value => { failure = value; }, clean: () => assert.equal(openConnections, 0) };
}
const message = (text, id = 'message_1234') => ({ text, client_message_id: id });

test('customer and assigned driver can exchange accepted-ride messages with server-derived roles', async () => {
    const f = fixture();
    const a = await f.chat.send(1, f.customer, { ...message('At the gate'), sender_role: 'driver' });
    const b = await f.chat.send(1, f.driver, message('On my way'));
    assert.equal(a.message.sender_role, 'customer');
    assert.deepEqual(a.recipient, { type: 'driver', id: 10 });
    assert.equal(b.message.sender_role, 'driver');
    assert.equal((await f.chat.history(1, f.customer)).messages.length, 2);
    f.clean();
});

test('unrelated users and share viewers cannot read, send, or report chat', async () => {
    const f = fixture();
    for (const actor of [{ userId: 20, phone: '' }, { userId: 'viewer_token', role: 'viewer' }]) {
        await assert.rejects(f.chat.history(1, actor), { status: 403 });
        await assert.rejects(f.chat.send(1, actor, message('intrusion')), { status: 403 });
        await assert.rejects(f.chat.report(1, actor, 'report'), { status: 403 });
    }
    assert.equal(f.state().messages.length, 0);
    f.clean();
});

test('requested/completed/cancelled rides cannot chat and dual-role owners are customers', async () => {
    const f = fixture();
    for (const status of ['Requested', 'Completed', 'Cancelled']) {
        f.state().ride.Ride_Status = status;
        await assert.rejects(f.chat.history(1, f.customer), { status: 410 });
    }
    f.state().ride.Ride_Status = 'Accepted';
    assert.equal((await f.chat.history(1, { ...f.customer, role: 'driver' })).my_role, 'customer');
    f.clean();
});

test('message retries are idempotent and do not duplicate reports or push recipients', async () => {
    const f = fixture();
    await f.chat.send(1, f.customer, message('Hello'));
    await f.chat.report(1, f.customer, 'Safety concern');
    const retry = await f.chat.send(1, f.customer, message('Hello'));
    assert.equal(retry.duplicate, true);
    assert.equal(retry.recipient, undefined);
    assert.equal(f.state().messages.length, 1);
    assert.equal(f.state().reports[0].transcript.length, 1);
    f.clean();
});

test('report retains the full conversation and later messages after active chat deletion', async () => {
    const f = fixture();
    await f.chat.send(1, f.customer, message('Pickup details'));
    await f.chat.report(1, f.customer, 'Harassment');
    await f.chat.send(1, f.driver, message('Reply'));
    assert.equal((await f.chat.report(1, f.customer, 'Repeated')).already_reported, true);
    await f.end();
    assert.equal(f.state().messages.length, 0);
    assert.deepEqual(f.state().reports[0].transcript.map(m => m.text), ['Pickup details', 'Reply']);
    await assert.rejects(f.chat.history(1, f.customer), { status: 410 });
    f.clean();
});

test('unreported chat is deleted when a ride is cancelled', async () => {
    const f = fixture();
    await f.chat.send(1, f.customer, message('Hello'));
    await f.end('Cancelled');
    assert.equal(f.state().messages.length, 0);
    assert.equal(f.state().reports.length, 0);
    f.clean();
});

test('concurrent report and completion cannot create a partial or lost transcript', async () => {
    const f = fixture();
    await f.chat.send(1, f.customer, message('Evidence'));
    await Promise.all([f.chat.report(1, f.customer, 'Concern'), f.end()]);
    assert.equal(f.state().reports[0].transcript[0].text, 'Evidence');
    assert.equal(f.state().messages.length, 0);
    f.clean();
});

test('message racing completion cannot re-create chat after ride end', async () => {
    const f = fixture();
    const results = await Promise.allSettled([f.end(), f.chat.send(1, f.customer, message('Late message'))]);
    assert.equal(results[1].status, 'rejected');
    assert.equal(results[1].reason.status, 410);
    assert.equal(f.state().messages.length, 0);
    f.clean();
});

test('failed report append rolls back the message and preserves report integrity', async () => {
    const f = fixture();
    await f.chat.send(1, f.customer, message('Evidence'));
    await f.chat.report(1, f.customer, 'Concern');
    f.fail('UPDATE reported_Chat');
    await assert.rejects(f.chat.send(1, f.driver, message('Reply')));
    assert.equal(f.state().messages.length, 1);
    assert.equal(f.state().reports[0].transcript.length, 1);
    f.clean();
});

test('failed deletion rolls back ride closure rather than leave messages on an ended ride', async () => {
    const f = fixture();
    await f.chat.send(1, f.customer, message('Hello'));
    f.fail('DELETE FROM ride_chat_messages');
    await assert.rejects(f.end());
    assert.equal(f.state().ride.Ride_Status, 'Accepted');
    assert.equal(f.state().messages.length, 1);
    f.clean();
});

test('empty/oversize messages and rapid sends are rejected; text is stored literally', async () => {
    const f = fixture();
    await assert.rejects(f.chat.send(1, f.customer, message(' ')), { status: 400 });
    await assert.rejects(f.chat.send(1, f.customer, message('a'.repeat(1001))), { status: 400 });
    await f.chat.send(1, f.customer, message("<script>alert('hi')</script>"));
    await assert.rejects(f.chat.send(1, f.customer, message('Spam', 'message_2345')), { status: 429 });
    f.advance();
    await f.chat.send(1, f.customer, message('Next', 'message_2345'));
    assert.equal(f.state().messages[0].message_text, "<script>alert('hi')</script>");
    f.clean();
});

test('disabled feature fails before borrowing a database connection', async () => {
    const chat = createRideChatService({ getConnection() { throw new Error('Should not connect'); } }, { enabled: false });
    await assert.rejects(chat.history(1, { userId: 99 }), { status: 503 });
});

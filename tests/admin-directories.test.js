const test = require('node:test');
const assert = require('node:assert/strict');
const { createAdminDirectoriesService } = require('../services/adminDirectories');
function fixture({ empty = false, fail = false, columns = ['id', 'created_at', 'status'] } = {}) {
    const queries = []; let released = 0;
    const query = async (sql, params) => {
        queries.push({ sql, params });
        assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|ALTER|CREATE)\b/i);
        if (sql.startsWith('SHOW')) return [columns.map(Field => ({ Field }))];
        if (fail) throw new Error('private database failure');
        if (sql.startsWith('SELECT COUNT')) return [[{ total: empty ? 0 : '21' }]];
        return [empty ? [] : [{ id: 7, fare: '120.50', rider: null, driver: null, trips: '3', joined_at: null, ride_at: '1794000000000', created_at: '1794000000000' }]];
    };
    const pool = { query, getConnection: async () => ({ query, release() { released++; } }) };
    return { service: createAdminDirectoriesService(pool), queries, released: () => released };
}
test('rides search, status and paging are parameterized and normalize fares', async () => {
    const f = fixture(); const result = await f.service.rides({ q: '50%_', status: 'completed', page: '2' });
    assert.equal(result.rides[0].fare, 120.5); assert.equal(result.rides[0].driver, 'Not assigned');
    assert.deepEqual(result.pagination, { page: 2, limit: 20, total: 21, totalPages: 2 });
    assert.equal(f.queries[0].params[0], '%50=%=_%'); assert.equal(f.queries[0].params.at(-1), 'completed');
    assert.deepEqual(f.queries[1].params.slice(-2), [20, 20]); assert.equal(f.released(), 1);
});
test('riders restrict customer roles, count trips, and exclude credentials', async () => {
    const f = fixture(); const result = await f.service.riders({ status: 'deleted', q: "' OR 1=1" });
    assert.equal(result.riders[0].trips, 3); assert.equal(result.riders[0].joined_at, null);
    for (const { sql } of f.queries) {
        assert.match(sql, /'rider', 'user', 'customer', ''/); assert.match(sql, /AccountDeleted/);
        assert.doesNotMatch(sql, /Password|Cnic|fcm|SELECT \*/i); assert.doesNotMatch(sql, /OR 1=1/);
    }
});
test('support reads stored complaints using verified optional columns', async () => {
    const f = fixture(); const result = await f.service.support({ q: 'payment' });
    assert.equal(result.queries[0].created_at, 1794000000000);
    assert.match(f.queries.at(-1).sql, /c.issue_description AS message/);
    assert.match(f.queries.at(-1).sql, /c.status AS status/);
    const legacy = fixture({ columns: ['complaint_id'] }); await legacy.service.support();
    assert.match(legacy.queries.at(-1).sql, /c.complaint_id AS id/);
    assert.match(legacy.queries.at(-1).sql, /NULL AS created_at/);
});
test('invalid filters fail before database access', async () => {
    for (const method of ['rides', 'riders', 'support']) {
        for (const query of [{ page: 0 }, { limit: 101 }, { q: [] }, { q: 'a'.repeat(101) }, { status: {} }, { status: 'invalid' }]) {
            const f = fixture(); await assert.rejects(async () => f.service[method](query), { status: 400 }); assert.equal(f.queries.length, 0);
        }
    }
});
test('empty lists stay empty and query failures release connections', async () => {
    for (const method of ['rides', 'riders', 'support']) {
        const f = fixture({ empty: true }); const data = await f.service[method]();
        assert.equal(data.pagination.total, 0); assert.deepEqual(data[method === 'support' ? 'queries' : method], []);
        const failed = fixture({ fail: true }); await assert.rejects(async () => failed.service[method](), /private database failure/); assert.equal(failed.released(), 1);
    }
});

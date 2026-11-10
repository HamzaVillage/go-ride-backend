const test = require('node:test');
const assert = require('node:assert/strict');
const { createAdminFranchisesService } = require('../services/adminFranchises');
function fixture({ empty = false, fail = false } = {}) {
    const queries = []; let released = 0;
    const pool = { getConnection: async () => ({ release() { released++; }, async query(sql, params) {
        queries.push({sql, params});
        assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|ALTER|CREATE)\b/i);
        if (fail) throw new Error('private query failure');
        if (sql.startsWith('SELECT COUNT')) return [[{total: empty ? 0 : '21'}]];
        return [empty ? [] : [{id: 7, company_name: 'Test Franchise', profile_complete: 0, driver_count: '4', rider_count: '0', franchise_fee: '1000.50', royalty_fee: null, created_at: '1794000000000'}]];
    } }) };
    return { queries, released: () => released, service: createAdminFranchisesService(pool) };
}
test('franchise listing binds search/status/paging and counts linked accounts', async () => {
    const f = fixture(); const data = await f.service.list({page: '2', limit: '20', status: 'pending', q: '50%_'});
    assert.deepEqual(data.pagination, {page: 2, limit: 20, total: 21, totalPages: 2});
    assert.equal(data.franchises[0].driver_count, 4); assert.equal(data.franchises[0].rider_count, 0); assert.equal(data.franchises[0].profile_complete, false);
    assert.equal(f.queries[0].params[0], '%50=%=_%'); assert.equal(f.queries[0].params.at(-1), 'pending');
    assert.deepEqual(f.queries[1].params.slice(-2), [20, 20]);
    assert.match(f.queries[1].sql, /d.Franchiser_ID_FK = f.id/); assert.match(f.queries[1].sql, /AccountDeleted/); assert.match(f.queries[1].sql, /'rider', 'user', 'customer', ''/);
    assert.doesNotMatch(f.queries[1].sql, /SELECT \*|password|fcm_token/i); assert.equal(f.released(), 1);
});
test('details return full business fields, normalize decimals, and preserve nulls', async () => {
    const f = fixture(); const row = await f.service.get('7');
    assert.equal(row.franchise_fee, 1000.5); assert.equal(row.royalty_fee, null); assert.equal(row.created_at, 1794000000000);
    assert.match(f.queries[0].sql, /f.legal_name/); assert.match(f.queries[0].sql, /f.contract_term_years/);
    assert.deepEqual(f.queries[0].params, [7]); assert.equal(f.released(), 1);
});
test('invalid franchise filters and IDs never borrow a database connection', async () => {
    const f = fixture();
    for (const query of [{page: 0}, {limit: 101}, {status: 'deleted'}, {status: []}, {q: []}, {q: 'a'.repeat(101)}]) await assert.rejects(f.service.list(query), {status: 400});
    for (const id of [0, -1, '1 OR 1=1', [], {}, '1.2', '2147483648']) await assert.rejects(f.service.get(id), {status: 400});
    assert.equal(f.queries.length, 0); assert.equal(f.released(), 0);
});
test('empty lists, absent franchises and query failures release connections', async () => {
    const f = fixture({empty:true}); assert.deepEqual((await f.service.list()).franchises, []);
    await assert.rejects(f.service.get(99), {status:404}); assert.equal(f.released(), 2);
    const failed = fixture({fail:true}); await assert.rejects(failed.service.list(), /private query failure/); await assert.rejects(failed.service.get(7), /private query failure/); assert.equal(failed.released(), 2);
});

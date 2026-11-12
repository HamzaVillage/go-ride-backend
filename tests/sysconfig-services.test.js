const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

test('public system configuration exposes service switches and releases its connection', async () => {
    const flags = { ride_service: 1, city_to_city_service: 1, courier_service: 0, food_delivery_service: 0, grocery_service: 0, hotel_booking_service: 1, car_rental_service: 0 };
    let released = false;
    const conn = { release() { released = true; }, async query(sql) {
        for (const key of Object.keys(flags)) assert.ok(sql.includes(key));
        assert.match(sql, /WHERE SCS_ID_Pk = 1/);
        return [[flags]];
    } };
    const context = { module: { exports: {} }, console, require: id => {
        if (id === '../db/Connect_Db') return { getConnection: async () => conn };
        if (id === '../services/redisCache') return { cache: { remember: async (_key, _ttl, read) => read() } };
        if (id === '../services/rideChatService') return { isChatEnabled: () => false };
        throw new Error(`Unexpected import: ${id}`);
    } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../controller/sysConfigController.js'), 'utf8'), context);
    const res = { json(body) { this.body = body; }, status(code) { this.code = code; return this; } };
    await context.module.exports.getConfig({}, res);
    assert.equal(res.body.success, true);
    for (const [key, value] of Object.entries(flags)) assert.equal(res.body.data[key], value);
    assert.equal(released, true);
});

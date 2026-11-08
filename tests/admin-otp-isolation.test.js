const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
for (const role of ['admin','superadmin',' ADMIN ']) test(`customer OTP cannot issue ${role} tokens`, async () => {
    let rolledBack = false; let signed = false; let released = false;
    const conn = { beginTransaction: async () => {}, rollback: async () => { rolledBack = true; }, release: () => { released = true; }, async query(sql) {
        if (sql.includes('FROM otp_verifications')) return [[{purpose:'general',otp_hash:'111111'}]];
        if (sql.includes('FROM users')) { assert.match(sql, /NOT IN \('driver', 'admin', 'superadmin'\)/); return [[{User_ID_Pk:1,Role:role}]]; }
        throw new Error(`Unexpected query: ${sql}`);
    } };
    const deps = { '../db/Connect_Db':{getConnection:async () => conn}, jsonwebtoken:{sign(){signed=true;}}, '../utils/driverHelper':{} };
    const context = { module:{exports:{}}, console:{log(){},error(){}}, process, require: id => id in deps ? deps[id] : require(id) };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../controller/authController.js'),'utf8'),context);
    const res = {statusCode:200,status(code){this.statusCode=code;return this;},json(body){this.body=body;}};
    await context.module.exports.verifyOtp({body:{phone_number:'03000000000',otp:'111111'}},res);
    assert.equal(res.statusCode,403); assert.equal(signed,false); assert.equal(rolledBack,true); assert.equal(released,true);
});

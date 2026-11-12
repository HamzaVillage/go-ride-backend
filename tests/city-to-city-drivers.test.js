const test = require('node:test');
const assert = require('node:assert/strict');
const { createCityToCityDrivers, validateApplication } = require('../services/cityToCityDrivers');
const body = () => ({ Name: 'Ali', FatherName: 'Ahmed', Cnic: '42101-1234567-1', DOB: '1995-02-20', Address: 'Karachi', Home_City_ID: '1', Vehicle_Type: 'Sedan', Vehicle_Make: 'Toyota', Vehicle_Model: 'Corolla', Manufacture_Year: '2022', Vehicle_Number: 'abc-123', Vehicle_Color: 'White', Passenger_Capacity: '4', Max_Parcel_Weight_Kg: '20', Services: '["shared","private","parcel"]' });
function fixture({ existing = false, status = 'pending', cityRide = false, cityTrip = false, failure = false, deleted = false } = {}) {
    const calls = [], state = { existing, status, commits: 0, rollbacks: 0, released: 0 };
    const conn = { async beginTransaction() {}, async commit() { state.commits++; }, async rollback() { state.rollbacks++; }, release() { state.released++; },
        async query(sql, args) {
            calls.push({ sql, args });
            if (sql.includes('FROM users WHERE')) return [[{ User_ID_Pk: 7, User_Name: 'Ali', Mobile: '03001234567', Email: 'ali@example.com', Role: 'rider', AccountDeleted: deleted ? 1 : 0 }]];
            if (sql.includes('FROM ride_history')) return [cityRide ? [{ Ride_ID_Pk: 1 }] : []];
            if (sql.includes('FROM city_to_city_trips')) return [cityTrip ? [{ id: 5 }] : []];
            if (sql.includes('SELECT id, application_status FROM city_to_city_drivers')) return [state.existing ? [{ id: 12, application_status: status }] : []];
            if (sql.includes('FROM city_to_city_drivers d LEFT JOIN city c')) return [state.existing ? [{ id: 12, user_id: 7, application_status: state.status }] : []];
            if (sql.includes('FROM city WHERE')) return [[{ ID_PK: 1 }]];
            if (sql.includes('FROM city_to_city_services WHERE')) return [[{ id: 1, code: 'shared' },{ id: 2, code: 'private' },{ id: 3, code: 'parcel' }]];
            if (sql.startsWith('INSERT INTO city_to_city_drivers')) { state.existing = true; return [{ insertId: 12 }]; }
            if (sql.startsWith('INSERT INTO city_to_city_vehicles')) { if (failure) throw new Error('database failed'); return [{ insertId: 15 }]; }
            if (sql.startsWith('SELECT')) return [[]];
            return [{}];
        },
    };
    return { calls, state, service: createCityToCityDrivers({ getConnection: async () => conn }) };
}
test('city-to-city onboarding validates capacity, dates and service selection', () => {
    assert.equal(validateApplication(body()).seats, 4);
    assert.equal(validateApplication(body()).plate, 'ABC-123');
    for (const change of [{ Passenger_Capacity: '0' },{ Passenger_Capacity: '4.5' },{ Services: '["shared","shared"]' },{ Services: '["ride"]' },{ DOB: '2025-02-30' },{ Cnic: '123' },{ Vehicle_Type: 'Bike' },{ Max_Parcel_Weight_Kg: '-1' }]) assert.throws(() => validateApplication({ ...body(), ...change }), { status: 400 });
});
test('application is bound to authenticated user and writes only city-to-city tables', async () => {
    const f = fixture();
    const result = await f.service.register(7, { ...body(), user_id: 99, status: 'approved' }, { CNIC_Front: [{ storedPath: 'admin-private:test.jpg' }] });
    assert.equal(result.exists, true);
    const insert = f.calls.find(call => call.sql.startsWith('INSERT INTO city_to_city_drivers'));
    assert.equal(insert.args[0], 7);
    assert.match(insert.sql, /'pending'/);
    assert.ok(f.calls.some(call => call.sql.includes('INSERT INTO city_to_city_driver_documents') && call.args.includes('admin-private:test.jpg')));
    assert.equal(f.calls.filter(call => call.sql.startsWith('INSERT INTO city_to_city_driver_services')).length, 3);
    assert.equal(f.calls.some(call => /^(INSERT INTO|UPDATE|DELETE FROM) (drivers|users)\b/.test(call.sql)), false);
    assert.equal(f.state.commits, 1);
});
test('duplicate pending submission returns existing application; approved cannot be overwritten', async () => {
    const pending = fixture({ existing: true });
    assert.equal((await pending.service.register(7, body())).already_submitted, true);
    assert.equal(pending.calls.some(call => call.sql.startsWith('INSERT')), false);
    const approved = fixture({ existing: true, status: 'approved' });
    await assert.rejects(approved.service.register(7, body()), { status: 409 });
    assert.equal(approved.state.rollbacks, 1);
});
test('failed vehicle insertion rolls back the entire registration', async () => {
    const f = fixture({ failure: true });
    await assert.rejects(f.service.register(7, body()), /database failed/);
    assert.equal(f.state.commits, 0); assert.equal(f.state.rollbacks, 1); assert.equal(f.state.released, 1);
});
test('mode switch blocks active city rides and city-to-city trips on the server', async () => {
    for (const config of [{ cityRide: true },{ cityTrip: true }]) {
        const f = fixture(config);
        await assert.rejects(f.service.switchMode(7, 'city_to_city_driver'), { status: 409 });
        assert.equal(f.state.commits, 0);
    }
    assert.equal((await fixture().service.switchMode(7, 'city_to_city_driver')).needs_onboarding, true);
    const pending = await fixture({ existing: true }).service.switchMode(7, 'city_to_city_driver');
    assert.equal(pending.profile.application_status, 'pending');
    assert.equal(pending.mode, 'city_to_city_driver');
    await assert.rejects(fixture({ deleted: true }).service.account(7), { status: 403 });
});
test('rejected application resubmission disables dropped service approvals', async () => {
    const f = fixture({ existing: true, status: 'rejected' });
    await f.service.register(7, body());
    assert.ok(f.calls.some(call => call.sql.includes("approval_status='suspended'") && call.sql.startsWith('UPDATE city_to_city_driver_services')));
});


test('city-to-city registration does not require vehicle make or manufacture year',()=>{
 const data=body();delete data.Vehicle_Make;delete data.Manufacture_Year;
 const result=validateApplication(data);assert.equal(result.make,null);assert.equal(result.year,null);
 assert.equal(validateApplication({...data,Vehicle_Type:'Ride AC'}).vehicleType,'Ride AC');
});

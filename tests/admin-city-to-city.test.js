const test = require('node:test');
const assert = require('node:assert/strict');
const { createAdminCityToCityDrivers } = require('../services/adminCityToCityDrivers');
function fixture({ missingDocuments = false, currentStatus = 'pending', activeTrip = false } = {}) {
    const state = { queries: [], commits: 0, rollbacks: 0 };
    const conn = { async beginTransaction() {}, async commit() { state.commits++; }, async rollback() { state.rollbacks++; }, release() {}, async query(sql,args) {
        state.queries.push({ sql,args });
        if (sql.includes('FROM employee WHERE')) return [[{ emp_id: 1, account_type:'superadmin', is_active:1,is_deleted:0 }]];
        if (sql.includes('SELECT home_city_id')) return [[{home_city_id:1}]];
        if (sql.includes('SELECT id,application_status')) return [[{ id: 12, application_status: currentStatus }]];
        if (sql.includes('FROM city_to_city_trips')) return [activeTrip ? [{ id: 9 }] : []];
        if (sql.includes('FROM city_to_city_vehicles')) return [[{ id: 15 }]];
        if (sql.includes('FROM city_to_city_driver_documents')) return [missingDocuments ? [] : ['photo','cnic_front','cnic_back','license','vehicle_registration'].map((type,index) => ({ id: index+1, document_type: type, vehicle_id: index === 4 ? 15 : null }))];
        if (sql.includes('FROM city_to_city_driver_services')) return [[{ id: 3 }]];
        return [{}];
    } };
    return { state, service: createAdminCityToCityDrivers({ getConnection: async () => conn }) };
}
test('approval requires full documents and changes only city-to-city profile, vehicle and services', async () => {
    const f = fixture();
    await f.service.review(12, 1, { status: 'approved', expected_status: 'pending' });
    assert.equal(f.state.commits, 1);
    assert.equal(f.state.queries.filter(q => q.sql.startsWith('UPDATE')).length, 4);
    assert.equal(f.state.queries.some(q => /UPDATE (drivers|users|ride_history)\b/.test(q.sql)), false);
    const missing = fixture({ missingDocuments: true });
    await assert.rejects(missing.service.review(12,1,{ status:'approved',expected_status:'pending' }), { status: 400 });
    assert.equal(missing.state.rollbacks, 1);
});
test('review rejects stale application status and active city-to-city trips', async () => {
    await assert.rejects(fixture({ currentStatus: 'rejected' }).service.review(12,1,{ status:'approved',expected_status:'pending' }), { status:409 });
    await assert.rejects(fixture({ activeTrip: true }).service.review(12,1,{ status:'approved',expected_status:'pending' }), { status:409 });
    await assert.rejects(fixture().service.review(12,1,{ status:'rejected',expected_status:'pending' }), { status:400 });
});

test('completing imported vehicle metadata preserves pending approval and reused documents', async () => {
    for (const originalType of ['Car','Bike']) {
    const queries=[];
    let committed=false;
    const conn={beginTransaction:async()=>{},commit:async()=>{committed=true;},rollback:async()=>{},release(){},async query(sql,args){
        queries.push({sql,args});
        if(sql.includes('FROM employee WHERE')) return [[{emp_id:1,account_type:'superadmin',is_active:1,is_deleted:0}]];
        if(sql.includes('SELECT * FROM city_to_city_drivers')) return [[{id:12,enrollment_source:'city_driver',application_status:'pending',source_snapshot:JSON.stringify({vehicle_type:originalType,model:'Corolla',registration_number:'ABC-123'}),easypaisa:null,jazzcash:null}]];
        if(sql.includes('FROM city WHERE')) return [[{ID_PK:1}]];
        if(sql.includes('FROM city_to_city_services')) return [[{id:1,code:'shared'}]];
        if(sql.includes('SELECT id FROM city_to_city_vehicles')) return [[]];
        if(sql.startsWith('INSERT INTO city_to_city_vehicles')) return [{insertId:15}];
        return [{}];
    }};
    const service=createAdminCityToCityDrivers({getConnection:async()=>conn});
    const result=await service.completeImported(12,1,{Name:'Test Driver',Cnic:'1234512345671',DOB:'1990-01-01',Home_City_ID:1,Address:'Test address',Vehicle_Type:'Sedan',Vehicle_Make:'Toyota',Vehicle_Model:'Corolla',Manufacture_Year:2020,Vehicle_Number:'ABC-123',Vehicle_Color:'White',Passenger_Capacity:4,Services:'["shared"]'});
    assert.equal(result.application_status,'pending');
    assert.equal(committed,true);
    assert.equal(queries.some(q=>q.sql.startsWith('UPDATE city_to_city_driver_documents SET vehicle_id=') && q.args[0]===15), originalType === 'Car');
    assert.ok(queries.some(q=>q.sql.includes("application_status='pending'") && q.sql.includes('is_online=0')));
    assert.equal(queries.some(q=>/^(UPDATE|INSERT INTO) (drivers|users|ride_history)\b/.test(q.sql)),false);
    assert.equal(queries.some(q=>q.sql.includes("approval_status='approved'")),false);
    }
});

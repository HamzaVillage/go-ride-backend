const test = require('node:test');
const assert = require('node:assert/strict');
const { createAdminOverviewService, overviewRange } = require('../services/adminOverview');
const now = Date.parse('2026-11-06T08:00:00Z');
function fixture({empty=false,fail=false}={}) {
    const range=overviewRange('7',now);const state={committed:false,rolledBack:false,released:false,queries:[]};
    const conn={async commit(){state.committed=true;},async rollback(){state.rolledBack=true;},release(){state.released=true;},async query(sql,params){
        state.queries.push({sql,params});assert.doesNotMatch(sql,/\b(INSERT|UPDATE|DELETE|ALTER|CREATE)\b/i);
        if(sql.startsWith('SET TRANSACTION')||sql.startsWith('START TRANSACTION'))return [[]];
        if(sql.includes('FROM users')) {if(fail)throw new Error('private database error');assert.match(sql,/AccountDeleted/);assert.match(sql,/'rider', 'user', 'customer', ''/);return [[{total_users:empty?0:'30',total_riders:empty?0:'22'}]];}
        if(sql.includes('FROM drivers')&&sql.includes('AS status'))return [empty?[]:[{status:'active',count:'10',online:'3'},{status:'pending',count:5,online:0},{status:'unverified',count:2,online:0},{status:'blocked',count:1,online:0}]];
        if(sql.includes('FROM drivers'))return [empty?[]:[{city:'Lahore',count:10},{city:'Karachi',count:8}]];
        if(sql.includes('GROUP BY day_index')){assert.match(sql,/UNIX_TIMESTAMP\(Ride_Date\) \+ 18000/);return [empty?[]:[{day_index:range.firstDayIndex,total:2,completed:1,cancelled:1,gross_fare:'100.50',platform_fees:'10.05'},{day_index:String(range.firstDayIndex+6),total:5,completed:3,cancelled:1,gross_fare:'200.25',platform_fees:'20.02'}]];}
        if(sql.includes('FROM ride_history r'))return [empty?[]:[{ride_id:10,rider:null,driver:null,pickup:'A',destination:'B',fare:'100.50',status:'Completed',ride_at:String(now)}]];
        if(sql.includes('FROM ride_history'))return [empty?[]:[{status:'completed',count:'4',gross_fare:'300.75',platform_fees:'30.07'},{status:'cancelled',count:2,gross_fare:0,platform_fees:0},{status:'requested',count:1,gross_fare:0,platform_fees:0}]];
        throw new Error(`Unexpected SQL: ${sql}`);
    }};
    return {state,service:createAdminOverviewService({getConnection:async()=>conn},{now:()=>now})};
}
test('overview separates all-time account counts and period ride totals',async()=>{
    const f=fixture();const result=await f.service.get({days:'7'});
    assert.deepEqual(result.range,{days:7,timezone:'Asia/Karachi',startDate:'2026-10-31',endDate:'2026-11-06'});
    assert.equal(result.accounts.total_users,30);assert.equal(result.accounts.total_riders,22);assert.equal(result.accounts.total_drivers,18);assert.equal(result.accounts.online_drivers,3);assert.equal(result.accounts.pending_drivers,7);
    assert.equal(result.rides.total,7);assert.equal(result.rides.completed,4);assert.equal(result.rides.cancelled,2);assert.equal(result.rides.completion_rate,57.1);assert.equal(result.rides.gross_fare,300.75);assert.equal(result.rides.platform_fees,30.07);
    assert.equal(result.driver_cities[0].percentage,55.6);assert.equal(f.state.committed,true);assert.equal(f.state.released,true);
    assert.match(f.state.queries[1].sql,/WITH CONSISTENT SNAPSHOT, READ ONLY/);
});
test('daily series fills missing days with zeroes and matches totals',async()=>{
    const result=await fixture().service.get({days:'7'});
    assert.equal(result.daily.length,7);assert.equal(result.daily[1].total,0);assert.equal(result.daily[1].gross_fare,0);assert.equal(result.daily.at(-1).date,'2026-11-06');
    assert.equal(result.daily.reduce((sum,day)=>sum+day.total,0),result.rides.total);
    assert.equal(result.daily.reduce((sum,day)=>sum+day.completed,0),result.rides.completed);
    assert.equal(result.recent_rides[0].rider,'Unavailable rider');assert.equal(result.recent_rides[0].driver,'Not assigned');assert.equal(result.recent_rides[0].fare,100.5);assert.equal(result.recent_rides[0].ride_at,now);
});
test('Pakistan midnight boundaries use UTC epochs independently of server timezone',()=>{
    const after=overviewRange('1',Date.parse('2026-11-05T19:00:00Z'));assert.equal(after.startDate,'2026-11-06');assert.equal(after.startSeconds,Date.parse('2026-11-05T19:00:00Z')/1000);assert.equal(after.endSeconds,Date.parse('2026-11-06T19:00:00Z')/1000);
    const before=overviewRange('1',Date.parse('2026-11-05T18:59:59Z'));assert.equal(before.startDate,'2026-11-05');
    const month=overviewRange('30',now);assert.equal(month.startDate,'2026-10-08');assert.equal(month.endSeconds-month.startSeconds,30*86400);
});
test('invalid ranges are rejected before borrowing a connection',async()=>{
    const service=createAdminOverviewService({getConnection(){throw new Error('should not connect');}});
    for(const days of ['0','31','7 OR 1=1',7.5,null,[],{},['7']])await assert.rejects(service.get({days}),{status:400});
});
test('empty overview returns finite zeroes and a complete daily series',async()=>{
    const result=await fixture({empty:true}).service.get({days:'7'});assert.equal(result.rides.completion_rate,0);assert.equal(result.accounts.total_drivers,0);assert.equal(result.driver_cities.length,0);assert.equal(result.daily.length,7);assert.ok(result.daily.every(day=>day.total===0));assert.doesNotMatch(JSON.stringify(result),/NaN|Infinity/);
});
test('query failures roll back read snapshot and always release',async()=>{
    const f=fixture({fail:true});await assert.rejects(f.service.get(),/private database error/);assert.equal(f.state.committed,false);assert.equal(f.state.rolledBack,true);assert.equal(f.state.released,true);
});

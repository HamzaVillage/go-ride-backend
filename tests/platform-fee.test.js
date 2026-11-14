const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { includedPlatformFee, addedPlatformFee } = require('../services/platformFee');
const { calculateEstimatedFare } = require('../services/farePolicy');
const rate = { Base_Fare:300,Per_Km_Rate:0,Per_Minute_Rate:0,Fee_Percentage:10,Platform_Fee_RS:15,Platform_Fee_Is_Percentage:1 };
test('percentage mode preserves fee-inclusive pricing and ignores fixed PKR', () => {
    assert.deepEqual(includedPlatformFee(rate,330),{ fee:30,percentage:10,mode:'percentage' });
    assert.equal(calculateEstimatedFare(rate,1,0,false,false).total_fare,330);
    assert.equal(includedPlatformFee({Fee_Percentage:10},330).fee,30,'legacy mode defaults to percentage');
});
test('fixed mode ignores percentage and charges the exact PKR amount', () => {
    const fixed={...rate,Platform_Fee_Is_Percentage:0};
    assert.deepEqual(includedPlatformFee(fixed,330),{fee:15,percentage:0,mode:'fixed'});
    const quote=calculateEstimatedFare(fixed,1,0,false,false);
    assert.equal(quote.total_fare,320);assert.equal(quote.organization_fee,15);assert.equal(quote.fee_percentage,0);assert.equal(quote.platform_fee_mode,'fixed');
    assert.equal(addedPlatformFee({...fixed,Platform_Fee_RS:0},300).fee,0);
});
test('invalid modes, negative fees, percentages above 100 and fee exceeding fare are rejected', () => {
    for(const changes of [{Platform_Fee_Is_Percentage:2},{Fee_Percentage:101},{Fee_Percentage:-1},{Platform_Fee_Is_Percentage:0,Platform_Fee_RS:-1}])assert.throws(()=>includedPlatformFee({...rate,...changes},330));
    assert.throws(()=>includedPlatformFee({...rate,Platform_Fee_Is_Percentage:0},10),{status:400});
    assert.throws(()=>includedPlatformFee(rate,NaN),{status:400});
});
async function book(config,total) {
    const writes=[];
    const conn={release(){},async query(sql,args){
        if(sql.includes('FROM vehicle_fare_rate'))return [[config]];
        if(sql.startsWith('INSERT INTO ride_history')){writes.push(args);return [{insertId:1}];}
        if(sql.includes('FROM ride_history'))return [[]];
        throw new Error(sql);
    }};
    const deps={
        '../services/offers': require('../services/offers'),
        '../services/platformFee':require('../services/platformFee'),
        '../services/rideCompletionSettlement':{},'../services/rideChatService':{},'../services/redisCache':{},'../services/rideSearch':{},
        '../services/driverDispatch':{validCoordinates:()=>true,category:()=>true,getSearchConfig:async()=>({}),dispatchRide:async()=>{}},
        '../db/Connect_Db':{getConnection:async()=>conn},'../socket/socketManager':{getIO:()=>({})},'../services/pushNotificationService':{},'../utils/driverHelper':{},crypto:require('node:crypto'),
    };
    const context={module:{exports:{}},require:id=>deps[id],console:{error(){}}};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../controller/rideController.js'),'utf8'),context);
    const res={statusCode:200,status(code){this.statusCode=code;return this;},json(body){this.body=body;}};
    await context.module.exports.createRide({user:{userId:99},body:{pickup_location:'A',drop_location:'B',pickup_lat:24,pickup_lng:67,drop_lat:25,drop_lng:68,vehicle_type:'Mini',fare:total,Organization_Fee:9999,Fee_Percentage:99}},res);
    return {res,writes};
}
test('booking stores the selected fee on the ride, ignoring client-supplied fee overrides',async()=>{
    for(const [config,expectedFee,expectedPercent] of [[rate,30,10],[{...rate,Platform_Fee_Is_Percentage:0},15,0]]){
        const {res,writes}=await book(config,330);assert.equal(res.statusCode,201);assert.equal(writes[0].at(-1),expectedFee);assert.equal(writes[0].at(-2),expectedPercent);
    }
});

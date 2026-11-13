const test=require('node:test'),assert=require('node:assert/strict');
const {formatCityToCityDriverCode:format}=require('../services/cityToCityDriverCode');
test('city driver codes pad the actual unique driver ID without truncating larger IDs',()=>{
 assert.equal(format(1),'CTC_0001');assert.equal(format(2),'CTC_0002');assert.equal(format(19),'CTC_0019');assert.equal(format(9999),'CTC_9999');assert.equal(format(10000),'CTC_10000');
 for(const id of [0,-1,1.5,NaN,Infinity])assert.throws(()=>format(id));
});

const test=require('node:test'),assert=require('node:assert/strict');
const {createEnrollmentSubmission,enrollmentFailure}=require('../services/normalDriverEnrollmentSubmission');
function fixture({failure,atUpload=0,replay=false}={}){
 const removed=[],logs=[],stored=[],calls=[];let response,status=200;
 const submit=createEnrollmentSubmission({requestId:()=> 'request-reference',remove:async path=>{removed.push(path);},log:(message,details)=>logs.push({message,details}),
  enrollment:{async enroll(...args){calls.push(args);if(failure && !atUpload)throw failure;return {id:5,user_id:42,status:'pending',...(replay?{already_submitted:true}:{})};}},
  async storeDocument(file,type){if(stored.length+1===atUpload)throw failure;const saved={storedPath:`stored:${type}`,filePath:`/test/${type}.jpg`};stored.push(saved);return saved;}
 });
 const res={set(){return this;},status(value){status=value;return this;},json(value){response=value;return this;}};
 return {submit:()=>submit({user:{userId:42},body:{user_id:99,Name:'Name'},files:{Photo:[{buffer:Buffer.from('photo')}],CNIC_Front:[{buffer:Buffer.from('front')}]}},res),removed,logs,stored,calls,get response(){return response;},get status(){return status;}};
}
test('submission uses authenticated rider identity, stores documents and retains committed files',async()=>{
 const f=fixture();await f.submit();assert.equal(f.status,200);assert.equal(f.response.user_id,42);assert.equal(f.calls[0][0],42);
 assert.deepEqual(f.calls[0][2],{Photo:'stored:photo',CNIC_Front:'stored:cnic_front'});assert.equal(f.removed.length,0);assert.equal(f.logs.length,0);
});
test('private upload permissions return a storage error and log safe operational context; earlier uploads are removed',async()=>{
 const failure=Object.assign(new Error('EACCES /secret/path cnic-private-details'),{code:'EACCES'}),f=fixture({failure,atUpload:2});await f.submit();
 assert.equal(f.status,503);assert.equal(f.response.code,'ENROLLMENT_STORAGE_UNAVAILABLE');assert.equal(f.response.request_id,'request-reference');assert.deepEqual(f.removed,['/test/photo.jpg']);assert.equal(f.calls.length,0);
 assert.deepEqual(f.logs[0].details,{request_id:'request-reference',stage:'document_upload',document_type:'cnic_front',error_code:'EACCES'});assert.doesNotMatch(JSON.stringify([f.response,f.logs]),/secret|cnic-private-details/);
});
test('duplicate driver details are a conflict; schema/setup failures are unavailable, without leaking SQL',async()=>{
 for(const [code,status,publicCode] of [['ER_DUP_ENTRY',409,'DRIVER_DETAILS_IN_USE'],['ER_BAD_FIELD_ERROR',503,'ENROLLMENT_SETUP_REQUIRED'],['ER_NO_SUCH_TABLE',503,'ENROLLMENT_SETUP_REQUIRED']]){
  const f=fixture({failure:Object.assign(new Error('SQL containing a phone and CNIC'),{code,sql:'sensitive query'})});await f.submit();assert.equal(f.status,status);assert.equal(f.response.code,publicCode);assert.equal(f.removed.length,2);assert.doesNotMatch(JSON.stringify([f.response,f.logs]),/sensitive query|phone and CNIC/);assert.equal(f.logs[0].details.stage,'driver_profile');
 }
});
test('validation messages remain actionable and uncertain submission retries clean up only new unused files',async()=>{
 const f=fixture({failure:Object.assign(new Error('Choose an active vehicle type.'),{status:400})});await f.submit();assert.equal(f.status,400);assert.equal(f.response.message,'Choose an active vehicle type.');assert.equal(f.logs.length,0);assert.equal(f.removed.length,2);
 const retry=fixture({replay:true});await retry.submit();assert.equal(retry.status,200);assert.equal(retry.response.already_submitted,true);assert.equal(retry.removed.length,2);
});
test('unclassified errors expose a generic failure and busy database errors are retryable',()=>{
 const unknown=enrollmentFailure(Object.assign(new Error('private internal details'),{code:'UNKNOWN'}));assert.equal(unknown.status,500);assert.doesNotMatch(unknown.message,/private internal/);
 for(const code of ['ER_LOCK_DEADLOCK','ER_LOCK_WAIT_TIMEOUT','ECONNREFUSED','ETIMEDOUT'])assert.equal(enrollmentFailure({code}).status,503);
});
test('database encoding failures identify only a known column, never submitted values or SQL',async()=>{
 const f=fixture({failure:Object.assign(new Error('private details'),{code:'ER_TRUNCATED_WRONG_VALUE_FOR_FIELD',sqlMessage:"Incorrect string value: 'private-user-value' for column 'full_name' at row 1",sql:'private SQL'})});
 await f.submit();assert.equal(f.status,500);assert.equal(f.logs[0].details.column,'full_name');assert.doesNotMatch(JSON.stringify([f.response,f.logs]),/private-user-value|private SQL|private details/);
});
test('duplicate diagnostics record only constraint names and distinguish CNIC conflicts from generated IDs',async()=>{
 for(const [key,status,code] of [['drivers.cnic',409,'DRIVER_CNIC_IN_USE'],['driver_code',503,'ENROLLMENT_SETUP_REQUIRED'],['PRIMARY',503,'ENROLLMENT_SETUP_REQUIRED']]){
  const f=fixture({failure:Object.assign(new Error('private duplicate'),{code:'ER_DUP_ENTRY',sqlMessage:`Duplicate entry 'private-value' for key '${key}'`})});await f.submit();assert.equal(f.status,status);assert.equal(f.response.code,code);assert.equal(f.logs[0].details.unique_key,key);assert.doesNotMatch(JSON.stringify([f.response,f.logs]),/private-value|private duplicate/);
 }
});

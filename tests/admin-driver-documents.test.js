const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');
const {detectFile,readDocument,storeDocument,MAX_BYTES}=require('../services/adminDriverDocuments');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6b1EAAAAASUVORK5CYII=','base64');
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'goride-private-doc-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const locations={publicRoot:path.join(root,'public'),privateRoot:path.join(root,'private'),base:new URL('https://fixture.example/uploads/')};await fs.mkdir(locations.publicRoot);await fs.mkdir(locations.privateRoot);return locations;}
test('uploaded identity document is stored privately, photo follows existing public convention',async t=>{
    const locations=await fixture(t);const doc=await storeDocument({buffer:png},'cnic_front',{locations});assert.match(doc.storedPath,/^admin-private:/);assert.equal((await readDocument(doc.storedPath,{locations})).mime,'image/png');const photo=await storeDocument({buffer:png},'photo',{locations});assert.match(photo.storedPath,/^https:\/\/fixture.example\/uploads\//);assert.equal((await readDocument(photo.storedPath,{locations})).mime,'image/png');
});
test('content signature controls type; HTML and PDF photo uploads are rejected',async t=>{
    const locations=await fixture(t);assert.equal(detectFile(png).mime,'image/png');assert.throws(()=>detectFile(Buffer.from('<html>not an image</html>')),{status:415});await assert.rejects(storeDocument({buffer:Buffer.from('%PDF-1.7 test')},'photo',{locations}),{status:415});await assert.rejects(storeDocument({buffer:Buffer.alloc(MAX_BYTES+1)},'license',{locations}),{status:413});
});
test('remote document reads reject unrelated hosts, traversal, and redirects',async t=>{
    const locations=await fixture(t);let requests=0;const fetchImpl=async(_url,options)=>{requests++;assert.equal(options.redirect,'error');return {ok:false,status:302};};
    for(const source of ['https://untrusted.example/uploads/private.png','https://fixture.example/outside/private.png','../private.png'])await assert.rejects(readDocument(source,{locations,fetchImpl}));assert.equal(requests,0);await assert.rejects(readDocument('https://fixture.example/uploads/missing.png',{locations,fetchImpl}),{status:502});assert.equal(requests,1);
});
test('a symlink cannot reveal files outside the configured upload directory',async t=>{
    const locations=await fixture(t);const outside=path.join(path.dirname(locations.publicRoot),'outside.png');await fs.writeFile(outside,png);await fs.symlink(outside,path.join(locations.publicRoot,'link.png'));await assert.rejects(readDocument('link.png',{locations}),{status:403});
});

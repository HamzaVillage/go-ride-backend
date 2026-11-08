const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {fail} = require('./adminDriverProfiles');
const MAX_BYTES=8*1024*1024;
function detectFile(buffer){
    if(buffer.length>=8&&buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return {mime:'image/png',ext:'.png'};
    if(buffer.length>=3&&buffer[0]===255&&buffer[1]===216&&buffer[2]===255)return {mime:'image/jpeg',ext:'.jpg'};
    if(buffer.length>=12&&buffer.toString('ascii',0,4)==='RIFF'&&buffer.toString('ascii',8,12)==='WEBP')return {mime:'image/webp',ext:'.webp'};
    if(buffer.length>=12&&buffer.toString('ascii',4,8)==='ftyp'&&['avif','avis'].includes(buffer.toString('ascii',8,12)))return {mime:'image/avif',ext:'.avif'};
    if(buffer.toString('ascii',0,5)==='%PDF-')return {mime:'application/pdf',ext:'.pdf'};
    throw fail(415,'Use a JPEG, PNG, WebP, AVIF image, or PDF document.');
}
const inside=(root,file)=>file.startsWith(`${path.resolve(root)}${path.sep}`);
function roots(){return {publicRoot:path.resolve(process.env.UPLOAD_DIR||path.join(__dirname,'../uploads')),privateRoot:path.resolve(process.env.ADMIN_DRIVER_DOCUMENT_DIR||path.join(__dirname,'../private_uploads/driver-documents')),base:new URL((process.env.BASE_UPLOAD_URL||'https://kinetworksportal.com/uploads/').replace(/\/?$/,'/'))};}
async function readBoundedFile(file){const handle=await fs.open(file,'r');try{const stat=await handle.stat();if(!stat.isFile()||stat.size>MAX_BYTES)throw fail(413,'Document is too large to preview.');return await handle.readFile();}finally{await handle.close();}}
async function readDocument(source,{fetchImpl=fetch,locations=roots()}={}){
    let local,remote;
    if(source.startsWith('admin-private:')){
        const name=source.slice('admin-private:'.length);if(!/^[a-f0-9-]+\.(png|jpg|webp|avif|pdf)$/.test(name))throw fail(404,'Document is unavailable.');local=path.resolve(locations.privateRoot,name);
    }else{
        let relative;
        if(/^https?:\/\//i.test(source)){
            const url=new URL(source);const basePath=decodeURIComponent(locations.base.pathname);
            const pathname=decodeURIComponent(url.pathname);
            if(url.origin!==locations.base.origin||url.username||url.password||!pathname.startsWith(basePath)||pathname.includes('\\'))throw fail(403,'This document location is not permitted.');
            relative=pathname.slice(basePath.length);remote=url;
        }else if(path.isAbsolute(source)&&inside(locations.publicRoot,path.resolve(source))){local=path.resolve(source);}
        else{relative=source.replace(/^\/?uploads\//,'');}
        if(relative!==undefined){if(relative.split(/[\\/]/).some(part=>part==='..'||part==='.')||relative.includes('\0'))throw fail(404,'Document is unavailable.');local=path.resolve(locations.publicRoot,relative);if(!inside(locations.publicRoot,local))throw fail(404,'Document is unavailable.');remote=remote||new URL(relative.split('/').map(encodeURIComponent).join('/'),locations.base);}
    }
    let buffer;
    try{const real=await fs.realpath(local);const allowed=source.startsWith('admin-private:')?locations.privateRoot:locations.publicRoot;const realRoot=await fs.realpath(allowed);if(!inside(realRoot,real))throw fail(403,'This document location is not permitted.');buffer=await readBoundedFile(real);}catch(error){
        if(error.code!=='ENOENT')throw error;
        if(!remote)throw fail(404,'Document file is unavailable.');
        let response;try{response=await fetchImpl(remote,{signal:AbortSignal.timeout(15000),redirect:'error'});}catch{throw fail(502,'Unable to load this document from storage.');}
        if(!response.ok)throw fail(response.status===404?404:502,'Document file is unavailable.');
        if(Number(response.headers.get('content-length'))>MAX_BYTES){await response.body?.cancel();throw fail(413,'Document is too large to preview.');}
        const parts=[];let size=0;for await(const part of response.body){size+=part.length;if(size>MAX_BYTES)throw fail(413,'Document is too large to preview.');parts.push(Buffer.from(part));}buffer=Buffer.concat(parts);
    }
    return {buffer,...detectFile(buffer)};
}
async function storeDocument(file,key,{locations=roots()}={}){
    if(!file?.buffer?.length)throw fail(400,'Choose a document file.');if(file.buffer.length>MAX_BYTES)throw fail(413,'Maximum document size is 8 MB.');
    const type=detectFile(file.buffer);if(key==='photo'&&!type.mime.startsWith('image/'))throw fail(415,'The driver photo must be an image.');
    const name=`${crypto.randomUUID()}${type.ext}`;
    // Identity documents are kept outside the public /uploads directory.
    const root=key==='photo'?locations.publicRoot:locations.privateRoot;
    await fs.mkdir(root,{recursive:true,mode:0o700});const filePath=path.join(root,name);await fs.writeFile(filePath,file.buffer,{flag:'wx',mode:0o600});
    return {storedPath:key==='photo'?new URL(name,locations.base).href:`admin-private:${name}`,filePath};
}
module.exports={MAX_BYTES,detectFile,readDocument,storeDocument};

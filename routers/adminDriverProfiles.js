const express=require('express');
const multer=require('multer');
const fs=require('node:fs/promises');
const {createAdminDriverProfiles,DOCUMENTS}=require('../services/adminDriverProfiles');
const {MAX_BYTES,readDocument,storeDocument}=require('../services/adminDriverDocuments');
function createDriverProfileRouter(pool){
    const router=express.Router();const service=createAdminDriverProfiles(pool);
    const sendError=(res,error)=>{if(!error.status)console.error('Admin driver profile request failed:',error.code||'INTERNAL_ERROR');res.status(error.status||500).json({success:false,code:error.code,message:error.status?error.message:'Unable to complete this driver request.'});};
    const respond=handler=>async(req,res)=>{try{res.json({success:true,data:await handler(req)});}catch(error){sendError(res,error);}};
    const guard=(req,res,next)=>{try{service.requireWrites();next();}catch(error){sendError(res,error);}};
    const parse=multer({storage:multer.memoryStorage(),limits:{fileSize:MAX_BYTES,files:1,fields:2,fieldSize:1024}}).single('document');
    router.get('/:driverId/profile',respond(req=>service.detail(req.params.driverId)));
    router.patch('/:driverId/profile',guard,respond(req=>service.update(req.params.driverId,req.user.employeeId,req.body)));
    router.get('/:driverId/documents/:key',async(req,res)=>{
        try{const source=await service.documentSource(req.params.driverId,req.params.key);const file=await readDocument(source);res.set({'Content-Type':file.mime,'X-Content-Type-Options':'nosniff','Content-Disposition':`inline; filename="driver-${req.params.driverId}-${req.params.key}${file.ext}"`,'Content-Security-Policy':"default-src 'none'; sandbox"});res.send(file.buffer);}catch(error){sendError(res,error);}
    });
    router.post('/:driverId/documents/:key',guard,(req,res,next)=>{
        if(!DOCUMENTS.some(doc=>doc.key===req.params.key))return res.status(400).json({success:false,message:'Unknown document type.'});
        parse(req,res,error=>{if(error)return res.status(error.code==='LIMIT_FILE_SIZE'?413:400).json({success:false,message:error.code==='LIMIT_FILE_SIZE'?'Maximum document size is 8 MB.':'Upload one file with its current profile version.'});next();});
    },async(req,res)=>{
        let stored;
        try{
            stored=await storeDocument(req.file,req.params.key);
            const data=await service.attachDocument(req.params.driverId,req.user.employeeId,req.params.key,req.body.version,stored.storedPath,req.body.replace==='true');
            res.json({success:true,data});
        }catch(error){
            // Preserve every pre-existing document, including on replacement. A
            // commit acknowledgement can be lost, so never remove a new file
            // after an uncertain database failure either.
            if(stored&&error.status&&error.status<500)await fs.unlink(stored.filePath).catch(()=>{});
            sendError(res,error);
        }
    });
    return router;
}
module.exports={createDriverProfileRouter};

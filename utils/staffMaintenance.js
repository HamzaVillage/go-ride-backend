const fs = require('node:fs');
const path = require('node:path');
const marker = path.join(__dirname, '../private_uploads/staff-migrations/maintenance');
const active = () => fs.existsSync(marker);
const middleware = (_req,res,next) => active() ? res.status(503).json({success:false,message:'Staff accounts are being upgraded. Please sign in again shortly.'}) : next();
module.exports={marker,active,middleware};

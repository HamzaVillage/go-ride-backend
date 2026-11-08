const pool = require('../db/Connect_Db');
const { createAdminLogin } = require('../services/adminAuth');
module.exports = { login: createAdminLogin({ pool }) };

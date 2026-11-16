const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const { DOCS } = require('./normalDriverEnrollment');

// Do not return SQL, filesystem paths, document names or personal details to clients.
function duplicateKey(error) {
    if (error.code !== 'ER_DUP_ENTRY') return null;
    // Capture only the constraint identifier at the end, never the duplicate value.
    return String(error.sqlMessage || '').match(/for key ['`]([a-zA-Z0-9_.-]{1,128})['`]\s*$/i)?.[1] || null;
}
function enrollmentFailure(error) {
    if (Number.isInteger(error.status) && error.status >= 400 && error.status < 600)
        return { status: error.status, message: error.message };
    if (error.code === 'ER_DUP_ENTRY') {
        const key = duplicateKey(error)?.split('.').at(-1).toLowerCase();
        if (key === 'cnic') return {status:409,code:'DRIVER_CNIC_IN_USE',message:'This CNIC is already registered to a driver profile. Please contact support to review the existing account.'};
        if (key === 'driver_code' || key === 'primary') return {status:503,code:'ENROLLMENT_SETUP_REQUIRED',message:'Driver signup is temporarily unavailable. Please contact support.'};
        return { status: 409, code: 'DRIVER_DETAILS_IN_USE', message: 'A driver profile already uses these details. Please contact support.' };
    }
    if (['EACCES', 'EPERM', 'EROFS', 'ENOSPC', 'EDQUOT'].includes(error.code))
        return { status: 503, code: 'ENROLLMENT_STORAGE_UNAVAILABLE', message: 'Document uploads are temporarily unavailable. Please contact support and try again.' };
    if (['ER_BAD_FIELD_ERROR', 'ER_NO_SUCH_TABLE'].includes(error.code))
        return { status: 503, code: 'ENROLLMENT_SETUP_REQUIRED', message: 'Driver signup is temporarily unavailable. Please contact support.' };
    if (['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT', 'ECONNREFUSED', 'ETIMEDOUT', 'PROTOCOL_CONNECTION_LOST'].includes(error.code))
        return { status: 503, code: 'ENROLLMENT_TEMPORARILY_UNAVAILABLE', message: 'Driver signup is temporarily busy. Please try again.' };
    return { status: 500, code: 'ENROLLMENT_FAILED', message: 'Unable to submit enrollment. Please try again or contact support.' };
}

function createEnrollmentSubmission({ enrollment, storeDocument, remove = file => fs.unlink(file), log = (message, details) => console.error(message, details), requestId = randomUUID }) {
    return async (req, res) => {
        const stored = [], reference = requestId();
        let committed = false, stage = 'document_upload', documentType = null;
        res.set('X-Request-ID', reference);
        const cleanup = () => Promise.all(stored.map(file => remove(file.filePath).catch(() => {})));
        try {
            const paths = {};
            for (const [field, files] of Object.entries(req.files || {})) {
                if (!Object.hasOwn(DOCS, field)) throw Object.assign(new Error('Unknown document type.'), { status: 400 });
                documentType = DOCS[field][0];
                const saved = await storeDocument(files[0], documentType);
                stored.push(saved);
                paths[field] = saved.storedPath;
            }
            stage = 'driver_profile'; documentType = null;
            const result = await enrollment.enroll(req.user.userId, req.body, paths);
            committed = true;
            if (result.already_submitted) await cleanup();
            res.json({ success: true, message: 'Driver registration request submitted successfully!', ...result });
        } catch (error) {
            if (!committed) await cleanup();
            const failure = enrollmentFailure(error);
            const column = String(error.sqlMessage || '').match(/(?:for column|Unknown column) ['`]([a-zA-Z_][a-zA-Z0-9_.]*)['`]/i)?.[1];
            if (!error.status || failure.status >= 500) log('Driver enrollment failed', {
                request_id: reference, stage, document_type: documentType, ...(['User_ID_FK','full_name','father_name','cnic','Easypaisa','JazzCash','dob','phone','email','address','city','vehicle_type','vehicle_model','vehicle_number','vehicle_color','photo_path','cnic_front_path','cnic_back_path','license_path','vehicle_doc_path','password','driver_code','status','join_date'].includes(column) ? {column} : {}),
                ...(['insert_driver','assign_driver_code'].includes(error.enrollment_operation) ? {operation:error.enrollment_operation} : {}),
                ...(duplicateKey(error) ? {unique_key:duplicateKey(error)} : {}),
                error_code: typeof error.code === 'string' && /^[A-Z0-9_]+$/.test(error.code) ? error.code : 'INTERNAL_ERROR',
            });
            res.status(failure.status).json({ success: false, message: failure.message, ...(failure.code ? { code: failure.code } : {}), request_id: reference });
        }
    };
}
module.exports = { createEnrollmentSubmission, enrollmentFailure, duplicateKey };

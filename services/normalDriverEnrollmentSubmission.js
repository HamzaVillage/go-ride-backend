const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const { DOCS } = require('./normalDriverEnrollment');

// Do not return SQL, filesystem paths, document names or personal details to clients.
function enrollmentFailure(error) {
    if (Number.isInteger(error.status) && error.status >= 400 && error.status < 600)
        return { status: error.status, message: error.message };
    if (error.code === 'ER_DUP_ENTRY')
        return { status: 409, code: 'DRIVER_DETAILS_IN_USE', message: 'A driver profile already uses these details. Please contact support.' };
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
                error_code: typeof error.code === 'string' && /^[A-Z0-9_]+$/.test(error.code) ? error.code : 'INTERNAL_ERROR',
            });
            res.status(failure.status).json({ success: false, message: failure.message, ...(failure.code ? { code: failure.code } : {}), request_id: reference });
        }
    };
}
module.exports = { createEnrollmentSubmission, enrollmentFailure };

const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const path = require('path');
const fs = require('fs');

// Initialize S3 client if credentials exist
const bucketName = process.env.AWS_S3_BUCKET_NAME;
const region = process.env.AWS_REGION || 'us-east-1';
const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

let s3Client = null;
if (bucketName && accessKeyId && secretAccessKey) {
    s3Client = new S3Client({
        region,
        credentials: {
            accessKeyId,
            secretAccessKey,
        },
    });
    console.log(`✅ [S3] Service initialized for bucket: ${bucketName} (${region})`);
} else {
    console.warn(`⚠️ [S3] Credentials missing in .env (AWS_S3_BUCKET_NAME, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY). Uploads will fall back to local disk.`);
}

/**
 * Uploads a file to AWS S3 (or falls back to local disk storage if S3 is not configured).
 * @param {Object} file - Multer file object (buffer, originalname, mimetype)
 * @param {string} folder - Destination folder name (e.g. 'drivers', 'profiles')
 * @returns {Promise<string>} - Returns full public S3 URL or filename for fallback
 */
async function uploadToS3(file, folder = 'uploads') {
    if (!file) return null;

    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname || file.name || '.jpg').toLowerCase();
    const fileName = `${file.fieldname || 'file'}_${uniqueSuffix}${ext}`;
    const key = `${folder}/${fileName}`;

    if (s3Client && bucketName) {
        // Upload directly to S3
        const command = new PutObjectCommand({
            Bucket: bucketName,
            Key: key,
            Body: file.buffer,
            ContentType: file.mimetype || 'image/jpeg',
        });

        await s3Client.send(command);
        console.log(`✅ [S3 Upload] Uploaded ${key} to S3 bucket ${bucketName}`);

        return key; // Return folder/fileName (e.g. drivers/photo.jpg) so baseUploadUrl resolves correctly for all folders
    } else {
        // Fallback to local disk storage
        const localDir = path.join(process.cwd(), folder);
        if (!fs.existsSync(localDir)) {
            fs.mkdirSync(localDir, { recursive: true });
        }
        const filePath = path.join(localDir, fileName);
        fs.writeFileSync(filePath, file.buffer);
        console.log(`📁 [Local Fallback] Saved file locally to ${filePath}`);
        return fileName;
    }
}

module.exports = {
    uploadToS3,
};

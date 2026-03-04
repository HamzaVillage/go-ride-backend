const path = require('path');
const pool = require('../db/Connect_Db');

let admin = null;

function getFirebaseAdmin() {
    if (admin) return admin;
    try {
        admin = require('firebase-admin');
        const serviceAccountPath = path.join(__dirname, '..', 'config', 'goride-cc26b-firebase-adminsdk-fbsvc-1d7e88fd52.json');
        const serviceAccount = require(serviceAccountPath);
        admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
        console.log('🔔 Firebase Admin initialized (push notifications enabled)');
        return admin;
    } catch (e) {
        console.warn('Firebase Admin init failed:', e?.message || e);
        return null;
    }
}

function tokenPreview(token) {
    if (!token || token.length < 16) return '(no token)';
    return `${token.slice(0, 8)}...${token.slice(-8)}`;
}

/**
 * Get FCM token for a rider (user). userId = users.User_ID_Pk
 */
async function getFcmTokenForUser(userId) {
    if (!userId) {
        console.log('🔔 [FCM] getFcmTokenForUser: no userId');
        return null;
    }
    let conn;
    try {
        conn = await pool.getConnection();
        const [rows] = await conn.query('SELECT fcm_token FROM users WHERE User_ID_Pk = ? AND fcm_token IS NOT NULL AND fcm_token != ""', [userId]);
        const token = rows[0]?.fcm_token || null;
        console.log('🔔 [FCM] getFcmTokenForUser userId=', userId, token ? `token=${tokenPreview(token)}` : 'NO TOKEN');
        return token;
    } catch (e) {
        console.warn('getFcmTokenForUser error:', e?.message);
        return null;
    } finally {
        if (conn) conn.release();
    }
}

/**
 * Get FCM token for a driver. driverId = drivers.id
 */
async function getFcmTokenForDriver(driverId) {
    if (!driverId) {
        console.log('🔔 [FCM] getFcmTokenForDriver: no driverId');
        return null;
    }
    let conn;
    try {
        conn = await pool.getConnection();
        const [rows] = await conn.query('SELECT fcm_token FROM drivers WHERE id = ? AND fcm_token IS NOT NULL AND fcm_token != ""', [driverId]);
        const token = rows[0]?.fcm_token || null;
        console.log('🔔 [FCM] getFcmTokenForDriver driverId=', driverId, token ? `token=${tokenPreview(token)}` : 'NO TOKEN');
        return token;
    } catch (e) {
        console.warn('getFcmTokenForDriver error:', e?.message);
        return null;
    } finally {
        if (conn) conn.release();
    }
}

const ANDROID_CHANNEL_ID = 'goride_rides';

/**
 * Send push notification to a single device. Never throws; logs errors so ride flow is never affected.
 * @param {string} token - FCM device token
 * @param {string} title - Notification title
 * @param {string} body - Notification body
 * @param {object} data - Optional data payload (e.g. { ride_id, event })
 */
async function sendPushToDevice(token, title, body, data = {}) {
    const fb = getFirebaseAdmin();
    if (!fb) {
        console.log('🔔 [FCM] sendPushToDevice: Firebase Admin not initialized, skip');
        return;
    }
    if (!token) {
        console.log('🔔 [FCM] sendPushToDevice: no token, skip');
        return;
    }
    const dataStr = {};
    Object.keys(data).forEach(k => { dataStr[k] = String(data[k]); });
    try {
        const message = {
            token,
            notification: { title, body },
            data: dataStr,
            android: {
                priority: 'high',
                notification: {
                    channelId: ANDROID_CHANNEL_ID,
                },
            },
            apns: {
                payload: { aps: { sound: 'default', contentAvailable: true } },
                fcmOptions: {},
            },
        };
        console.log('🔔 [FCM] Sending push:', { title, body, data: dataStr, tokenPreview: tokenPreview(token) });
        const msgId = await fb.messaging().send(message);
        console.log('🔔 [FCM] Push sent successfully messageId=', msgId);
    } catch (e) {
        console.warn('🔔 [FCM] Push send error:', e?.message || e);
    }
}

/**
 * Notify customer (rider) - e.g. ride accepted, arrived, started, completed, cancelled
 */
async function notifyCustomer(userId, title, body, data = {}) {
    console.log('🔔 [FCM] notifyCustomer userId=', userId, 'title=', title);
    const token = await getFcmTokenForUser(userId);
    if (token) {
        await sendPushToDevice(token, title, body, data);
    } else {
        console.log('🔔 [FCM] notifyCustomer: no FCM token for userId=', userId);
    }
}

/**
 * Notify driver - e.g. when customer cancels ride
 */
async function notifyDriver(driverId, title, body, data = {}) {
    console.log('🔔 [FCM] notifyDriver driverId=', driverId, 'title=', title);
    const token = await getFcmTokenForDriver(driverId);
    if (token) {
        await sendPushToDevice(token, title, body, data);
    } else {
        console.log('🔔 [FCM] notifyDriver: no FCM token for driverId=', driverId);
    }
}

module.exports = {
    getFcmTokenForUser,
    getFcmTokenForDriver,
    sendPushToDevice,
    notifyCustomer,
    notifyDriver,
    ANDROID_CHANNEL_ID,
};

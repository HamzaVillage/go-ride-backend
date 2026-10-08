const jazzCashService = require('../services/jazzCashService');
const pool = require('../db/Connect_Db');

/**
 * Initiate JazzCash Payment (Card / Mobile Account)
 * Generates HMAC-SHA256 secure hash and returns post parameters + prebuilt auto-submitting HTML form
 */
async function initiateJazzCashPayment(req, res) {
    try {
        const {
            amount,
            billReference,
            description,
            txnType = 'MIGS', // 'MIGS' for Card, 'MPAY' for Mobile Account
            rideId,
            returnUrl,
            merchantId,
            password,
            integritySalt,
            customFields
        } = req.body;

        if (!amount || isNaN(amount) || parseFloat(amount) <= 0) {
            return res.status(400).json({
                success: false,
                message: 'A valid payment amount is required.'
            });
        }

        // Determine effective return URL (default to backend callback endpoint if not specified)
        const host = req.get('host');
        const protocol = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
        const defaultReturnUrl = `${protocol}://${host}/payment/jazzcash/callback`;
        const effectiveReturnUrl = returnUrl || process.env.JAZZCASH_RETURN_URL || defaultReturnUrl;

        const effectiveBillReference = billReference || (rideId ? `Ride_${rideId}` : `Bill_${Date.now()}`);
        const effectiveDescription = description || (rideId ? `GoRide Ride #${rideId} Payment` : 'GoRide Service Payment');

        const payload = jazzCashService.generatePaymentPayload({
            amount: parseFloat(amount),
            billReference: effectiveBillReference,
            description: effectiveDescription,
            txnType,
            returnUrl: effectiveReturnUrl,
            merchantId,
            password,
            integritySalt,
            customFields: {
                ...(customFields || {}),
                ppmpf_1: rideId ? String(rideId) : (customFields?.ppmpf_1 || '1')
            }
        });

        // Optionally record initiated transaction in database
        try {
            const userId = req.user?.userId || null;
            await pool.query(
                `INSERT INTO transactions (
                    user_id, ride_id, txn_ref_no, amount, payment_method, status, created_at
                ) VALUES (?, ?, ?, ?, ?, 'pending', NOW())
                ON DUPLICATE KEY UPDATE updated_at = NOW()`,
                [userId, rideId || null, payload.txnRefNo, parseFloat(amount), txnType === 'MIGS' ? 'Card' : 'JazzCash']
            ).catch(err => {
                // Non-blocking if table structure differs
                console.log('ℹ️ [JazzCash] Transaction log skipped or non-critical DB notice:', err.message);
            });
        } catch (dbErr) {
            // Non-blocking
        }

        return res.status(200).json({
            success: true,
            message: 'JazzCash payment initiated successfully.',
            data: {
                paymentPortalUrl: payload.paymentPortalUrl,
                txnRefNo: payload.txnRefNo,
                amount: payload.amount,
                amountInPaisa: payload.amountInPaisa,
                postData: payload.postData,
                html: payload.html,
                returnUrl: effectiveReturnUrl
            }
        });

    } catch (err) {
        console.error('❌ [JazzCash] initiateJazzCashPayment error:', err);
        return res.status(500).json({
            success: false,
            message: 'Failed to initiate JazzCash payment.',
            error: err.message
        });
    }
}

/**
 * Handle JazzCash Return Callback
 * JazzCash sends POST request back to pp_ReturnURL with transaction result
 */
async function handleJazzCashCallback(req, res) {
    try {
        const data = req.method === 'POST' ? req.body : req.query;
        console.log('🔔 [JazzCash Callback] Received payload:', data);

        const {
            pp_ResponseCode,
            pp_ResponseMessage,
            pp_TxnRefNo,
            pp_Amount,
            pp_BillReference,
            pp_RetreivalReferenceNo,
            pp_AuthCode,
            ppmpf_1: rideId
        } = data;

        const isSuccess = pp_ResponseCode === '000' || pp_ResponseCode === '121';
        const formattedAmount = pp_Amount ? (parseInt(pp_Amount, 10) / 100).toFixed(2) : '0.00';

        // Update ride / transaction in database if applicable
        if (rideId && isSuccess) {
            try {
                await pool.query(
                    `UPDATE rides SET Payment_Status = 'Paid', Payment_Method = 'JazzCash' WHERE Ride_ID = ?`,
                    [rideId]
                ).catch(() => {});
            } catch (err) {
                console.warn('⚠️ [JazzCash] Ride payment status update error:', err.message);
            }
        }

        const resultJson = JSON.stringify({
            success: isSuccess,
            responseCode: pp_ResponseCode,
            message: pp_ResponseMessage || (isSuccess ? 'Transaction Successful' : 'Transaction Failed'),
            txnRefNo: pp_TxnRefNo,
            amount: formattedAmount,
            billReference: pp_BillReference,
            retrievalRefNo: pp_RetreivalReferenceNo,
            authCode: pp_AuthCode,
            rideId: rideId || null
        });

        // HTML Response rendered for WebView and Mobile browser
        const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Payment Result</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            background-color: #0b0f19;
            color: #ffffff;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            padding: 24px;
        }
        .card {
            background: #161c2c;
            border: 1px solid #232c45;
            border-radius: 20px;
            padding: 32px 24px;
            text-align: center;
            max-width: 380px;
            width: 100%;
            box-shadow: 0 16px 36px rgba(0, 0, 0, 0.5);
        }
        .icon-circle {
            width: 68px;
            height: 68px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto 20px auto;
            font-size: 32px;
        }
        .icon-success {
            background: rgba(34, 232, 67, 0.15);
            color: #22E843;
            border: 2px solid #22E843;
        }
        .icon-failure {
            background: rgba(255, 77, 79, 0.15);
            color: #ff4d4f;
            border: 2px solid #ff4d4f;
        }
        h2 {
            font-size: 22px;
            font-weight: 700;
            margin-bottom: 8px;
            color: #ffffff;
        }
        p.desc {
            font-size: 14px;
            color: #8f9bb3;
            line-height: 1.5;
            margin-bottom: 24px;
        }
        .info-box {
            background: #0b0f19;
            border-radius: 12px;
            padding: 16px;
            margin-bottom: 24px;
            text-align: left;
        }
        .info-row {
            display: flex;
            justify-content: space-between;
            margin-bottom: 8px;
            font-size: 13px;
        }
        .info-row:last-child {
            margin-bottom: 0;
        }
        .info-label {
            color: #8f9bb3;
        }
        .info-val {
            color: #ffffff;
            font-weight: 600;
        }
        .btn {
            background: #23D0A3;
            color: #000000;
            border: none;
            border-radius: 10px;
            padding: 14px 20px;
            font-size: 15px;
            font-weight: bold;
            cursor: pointer;
            width: 100%;
            text-decoration: none;
            display: inline-block;
        }
    </style>
    <script type="text/javascript">
        // Post message to React Native WebView
        window.onload = function() {
            var payload = ${resultJson};
            if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
                window.ReactNativeWebView.postMessage(JSON.stringify(payload));
            }
        };

        function returnToApp() {
            var payload = ${resultJson};
            if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
                window.ReactNativeWebView.postMessage(JSON.stringify(payload));
            }
        }
    </script>
</head>
<body>
    <div class="card">
        <div class="icon-circle ${isSuccess ? 'icon-success' : 'icon-failure'}">
            ${isSuccess ? '✓' : '✕'}
        </div>
        <h2>${isSuccess ? 'Payment Successful!' : 'Payment Failed'}</h2>
        <p class="desc">${escapeHtml(pp_ResponseMessage || (isSuccess ? 'Your payment has been processed successfully.' : 'The transaction could not be completed.'))}</p>
        
        <div class="info-box">
            <div class="info-row">
                <span class="info-label">Transaction Ref:</span>
                <span class="info-val">${escapeHtml(pp_TxnRefNo || '-')}</span>
            </div>
            <div class="info-row">
                <span class="info-label">Amount:</span>
                <span class="info-val">PKR ${formattedAmount}</span>
            </div>
            <div class="info-row">
                <span class="info-label">Status Code:</span>
                <span class="info-val">${escapeHtml(pp_ResponseCode || '-')}</span>
            </div>
        </div>

        <button class="btn" onclick="returnToApp()">Return to GoRide</button>
    </div>
</body>
</html>`;

        res.setHeader('Content-Type', 'text/html');
        return res.send(html);

    } catch (err) {
        console.error('❌ [JazzCash Callback] Handler error:', err);
        return res.status(500).send('Error processing payment callback');
    }
}

/**
 * Check payment status by transaction reference
 */
async function getPaymentStatus(req, res) {
    try {
        const { txnRefNo } = req.params;
        if (!txnRefNo) {
            return res.status(400).json({ success: false, message: 'txnRefNo is required' });
        }

        const [rows] = await pool.query(
            `SELECT * FROM transactions WHERE txn_ref_no = ? LIMIT 1`,
            [txnRefNo]
        ).catch(() => [[]]);

        if (rows && rows.length > 0) {
            return res.json({ success: true, transaction: rows[0] });
        }

        return res.json({ success: true, message: 'Transaction status inquiry submitted', txnRefNo });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
}

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

module.exports = {
    initiateJazzCashPayment,
    handleJazzCashCallback,
    getPaymentStatus
};

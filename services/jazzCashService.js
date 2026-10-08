const crypto = require('crypto');

// JazzCash Configuration Defaults (loaded from process.env)
const JAZZCASH_CONFIG = {
    get merchantId() { return process.env.JAZZCASH_MERCHANT_ID || ''; },
    get password() { return process.env.JAZZCASH_PASSWORD || ''; },
    get integritySalt() { return process.env.JAZZCASH_INTEGRITY_SALT || ''; },
    get returnUrl() { return process.env.JAZZCASH_RETURN_URL || ''; },
    get isProduction() { return process.env.JAZZCASH_ENVIRONMENT === 'production'; },
    sandboxUrl: 'https://sandbox.jazzcash.com.pk/CustomerPortal/transactionmanagement/merchantform/',
    productionUrl: 'https://payments.jazzcash.com.pk/CustomerPortal/transactionmanagement/merchantform/'
};

/**
 * Format Date to JazzCash YYYYMMDDHHmmss string
 */
function formatJazzCashDate(date = new Date()) {
    const pad = (n) => String(n).padStart(2, '0');
    const year = date.getFullYear();
    const month = pad(date.getMonth() + 1);
    const day = pad(date.getDate());
    const hours = pad(date.getHours());
    const minutes = pad(date.getMinutes());
    const seconds = pad(date.getSeconds());
    return `${year}${month}${day}${hours}${minutes}${seconds}`;
}

/**
 * Get payment portal URL based on environment
 */
function getPaymentPortalUrl() {
    return JAZZCASH_CONFIG.isProduction ? JAZZCASH_CONFIG.productionUrl : JAZZCASH_CONFIG.sandboxUrl;
}

/**
 * Clean strings for JazzCash compatibility (Alphanumeric only, no punctuation)
 */
function sanitizeAlphanumeric(str, maxLen = 50) {
    if (!str) return '';
    return String(str)
        .replace(/[^a-zA-Z0-9 ]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, maxLen);
}

/**
 * Calculate JazzCash HMAC-SHA256 Secure Hash
 * Sorts all non-empty fields alphabetically, concatenates values with '&', and computes HMAC-SHA256 with Integrity Salt.
 * 
 * @param {Object} fields Key-value dictionary of form parameters
 * @param {string} salt Integrity salt key
 * @returns {string} Hex uppercase hash
 */
function calculateSecureHash(fields, salt = JAZZCASH_CONFIG.integritySalt) {
    if (!salt) {
        console.warn('⚠️ [JazzCash] Integrity Salt is empty. Secure hash will be empty.');
        return '';
    }

    // Filter out empty values and pp_SecureHash itself
    const sortedKeys = Object.keys(fields)
        .filter(key => key !== 'pp_SecureHash' && fields[key] !== undefined && fields[key] !== null && String(fields[key]).trim() !== '')
        .sort();

    // JazzCash hash string: Salt & sorted values joined with &
    let hashString = salt;
    for (const key of sortedKeys) {
        const val = String(fields[key]);
        hashString += `&${val}`;
    }

    const hash = crypto.createHmac('sha256', salt)
        .update(hashString)
        .digest('hex')
        .toUpperCase();

    return hash;
}

/**
 * Normalize JazzCash transaction type
 * 'MIGS' for Card Payment
 * 'MWALLET' for Mobile Account
 * 'OTC' for Voucher Payment
 */
function normalizeTxnType(type) {
    if (!type) return 'MIGS';
    const upper = String(type).toUpperCase();
    if (upper === 'CARD' || upper === 'MIGS') return 'MIGS';
    if (upper === 'MOBILE' || upper === 'MWALLET' || upper === 'MPAY') return 'MWALLET';
    if (upper === 'VOUCHER' || upper === 'OTC') return 'OTC';
    return upper;
}

/**
 * Generate complete payment payload and auto-submitting HTML form for JazzCash Card / Mobile Checkout
 * 
 * @param {Object} params
 * @param {number|string} params.amount Amount in PKR (e.g. 500 or 500.00)
 * @param {string} [params.billReference] Bill reference string
 * @param {string} [params.description] Description of transaction (must be alphanumeric)
 * @param {string} [params.txnType] Transaction type: 'MIGS' for Card, 'MWALLET' for Mobile Account
 * @param {string} [params.txnRefNo] Unique transaction reference
 * @param {string} [params.returnUrl] Return callback URL
 * @param {string} [params.merchantId] Override merchant ID
 * @param {string} [params.password] Override password
 * @param {string} [params.integritySalt] Override integrity salt
 * @param {Object} [params.customFields] Optional ppmpf_1 through ppmpf_5
 * @returns {Object} { postData, paymentPortalUrl, html, txnRefNo }
 */
function generatePaymentPayload({
    amount,
    billReference = 'billRef',
    description = 'GoRide Payment',
    txnType = 'MIGS',
    txnRefNo,
    returnUrl,
    merchantId,
    password,
    integritySalt,
    customFields = {}
}) {
    const activeMerchantId = merchantId || JAZZCASH_CONFIG.merchantId;
    const activePassword = password || JAZZCASH_CONFIG.password;
    const activeSalt = integritySalt || JAZZCASH_CONFIG.integritySalt;
    const activeReturnUrl = returnUrl || JAZZCASH_CONFIG.returnUrl;
    const portalUrl = getPaymentPortalUrl();

    const now = new Date();
    const expiry = new Date(now.getTime() + 24 * 60 * 60 * 1000); // +1 day
    const formattedTxnDateTime = formatJazzCashDate(now);
    const formattedExpiryDateTime = formatJazzCashDate(expiry);
    const activeTxnRefNo = txnRefNo || `T${formattedTxnDateTime}${Math.floor(100 + Math.random() * 900)}`;

    // JazzCash requires amount in Paisa format without decimals (Rs. 10 = 1000)
    const numericAmount = parseFloat(amount) || 0;
    const amountInPaisa = Math.round(numericAmount * 100).toString();

    // Sanitize Description and BillReference according to JazzCash rules (alphanumeric only)
    const sanitizedDescription = sanitizeAlphanumeric(description, 50) || 'GoRide Transaction';
    const sanitizedBillReference = sanitizeAlphanumeric(billReference, 20) || 'billRef';
    const normalizedTxnType = normalizeTxnType(txnType);

    const postData = {
        pp_Version: '1.1',
        pp_TxnType: normalizedTxnType,
        pp_Language: 'EN',
        pp_MerchantID: activeMerchantId,
        pp_SubMerchantID: '',
        pp_Password: activePassword,
        pp_BankID: 'TBANK',
        pp_ProductID: 'RETL',
        pp_TxnRefNo: activeTxnRefNo,
        pp_Amount: amountInPaisa,
        pp_TxnCurrency: 'PKR',
        pp_TxnDateTime: formattedTxnDateTime,
        pp_BillReference: sanitizedBillReference,
        pp_Description: sanitizedDescription,
        pp_TxnExpiryDateTime: formattedExpiryDateTime,
        pp_ReturnURL: activeReturnUrl,
        ppmpf_1: customFields.ppmpf_1 || '1',
        ppmpf_2: customFields.ppmpf_2 || '2',
        ppmpf_3: customFields.ppmpf_3 || '3',
        ppmpf_4: customFields.ppmpf_4 || '4',
        ppmpf_5: customFields.ppmpf_5 || '5',
    };

    // Calculate Secure Hash
    postData.pp_SecureHash = calculateSecureHash(postData, activeSalt);

    // Build the auto-submitting HTML form
    const inputsHtml = Object.entries(postData)
        .map(([key, val]) => `<input type="hidden" name="${key}" value="${escapeHtml(val)}" />`)
        .join('\n            ');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>JazzCash Payment</title>
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
            padding: 20px;
        }
        .container {
            background: #161c2c;
            border: 1px solid #232c45;
            border-radius: 16px;
            padding: 32px 24px;
            text-align: center;
            max-width: 360px;
            width: 100%;
            box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4);
        }
        .spinner {
            border: 4px solid rgba(255, 255, 255, 0.1);
            width: 48px;
            height: 48px;
            border-radius: 50%;
            border-left-color: #22E843;
            animation: spin 1s linear infinite;
            margin: 0 auto 20px auto;
        }
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        h2 {
            font-size: 18px;
            font-weight: 600;
            margin-bottom: 8px;
            color: #ffffff;
        }
        p {
            font-size: 13px;
            color: #8f9bb3;
            line-height: 1.5;
            margin-bottom: 20px;
        }
        .amount-badge {
            background: rgba(34, 232, 67, 0.12);
            color: #22E843;
            padding: 8px 16px;
            border-radius: 20px;
            font-size: 15px;
            font-weight: 600;
            display: inline-block;
            margin-bottom: 16px;
        }
        .manual-btn {
            background: #23D0A3;
            color: #000000;
            border: none;
            border-radius: 8px;
            padding: 10px 20px;
            font-size: 13px;
            font-weight: bold;
            cursor: pointer;
            width: 100%;
        }
    </style>
    <script type="text/javascript">
        function submitForm() {
            try {
                var form = document.getElementById('jsform') || document.forms['jsform'] || document.forms[0];
                if (form) {
                    form.submit();
                }
            } catch (err) {
                console.error("Form submit error", err);
            }
        }
        if (document.readyState === 'complete' || document.readyState === 'interactive') {
            submitForm();
        } else {
            document.addEventListener('DOMContentLoaded', submitForm);
            window.onload = submitForm;
        }
        setTimeout(submitForm, 50);
        setTimeout(function() {
            var btn = document.getElementById('proceedBtn');
            if (btn) btn.style.display = 'block';
        }, 1500);
    </script>
</head>
<body>
    <div class="container">
        <div class="spinner"></div>
        <h2>Connecting to JazzCash</h2>
        <p>Transferring securely to the payment portal...</p>
        <div class="amount-badge">Amount: PKR ${numericAmount.toFixed(2)}</div>
        
        <form name="jsform" id="jsform" method="POST" action="${portalUrl}">
            ${inputsHtml}
            <button type="submit" id="proceedBtn" class="manual-btn" style="margin-top: 12px;">Proceed to JazzCash</button>
        </form>
    </div>
</body>
</html>`;

    return {
        postData,
        paymentPortalUrl: portalUrl,
        html,
        txnRefNo: activeTxnRefNo,
        amount: numericAmount,
        amountInPaisa
    };
}

/**
 * Verify response hash returned by JazzCash
 * 
 * @param {Object} responseBody 
 * @param {string} [salt] 
 * @returns {boolean}
 */
function verifyResponseHash(responseBody, salt = JAZZCASH_CONFIG.integritySalt) {
    if (!responseBody || !responseBody.pp_SecureHash) {
        return false;
    }
    const expectedHash = calculateSecureHash(responseBody, salt);
    return expectedHash.toUpperCase() === String(responseBody.pp_SecureHash).toUpperCase();
}

/**
 * Escape HTML special characters
 */
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
    JAZZCASH_CONFIG,
    getPaymentPortalUrl,
    calculateSecureHash,
    generatePaymentPayload,
    verifyResponseHash,
    formatJazzCashDate,
    normalizeTxnType,
    sanitizeAlphanumeric
};

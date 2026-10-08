const pool = require('../db/Connect_Db');
const jazzCashService = require('../services/jazzCashService');

const walletController = {
    /**
     * Get user's wallet balance and summary
     */
    getWalletBalance: async (req, res) => {
        const userId = req.user?.userId;
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        let conn;
        try {
            conn = await pool.getConnection();

            // If user is a driver, check driver_wallet
            if (req.user?.role === 'driver') {
                const [dRows] = await conn.query(
                    "SELECT id, User_ID_FK FROM drivers WHERE User_ID_FK = ? OR REPLACE(phone, '-', '') = REPLACE(?, '-', '')",
                    [userId, req.user?.phone || '']
                );
                if (dRows.length > 0) {
                    const driverId = dRows[0].id;
                    const [dwStats] = await conn.query(
                        `SELECT 
                            COALESCE(SUM(CASE WHEN transaction_type = 'credit' AND status = 'completed' THEN amount ELSE 0 END), 0) -
                            COALESCE(SUM(CASE WHEN transaction_type = 'debit' AND status = 'completed' THEN amount ELSE 0 END), 0) as balance,
                            COALESCE(SUM(CASE WHEN transaction_type = 'credit' AND status = 'completed' THEN amount ELSE 0 END), 0) as total_credited,
                            COALESCE(SUM(CASE WHEN transaction_type = 'debit' AND status = 'completed' THEN amount ELSE 0 END), 0) as total_spent,
                            COUNT(CASE WHEN status = 'completed' THEN 1 END) as total_transactions
                         FROM driver_wallet WHERE driver_id = ?`,
                        [driverId]
                    );
                    let dBalance = parseFloat(dwStats[0]?.balance || 0);

                    if (dBalance === 0 && dRows[0].User_ID_FK) {
                        const [uwRows] = await conn.query(
                            "SELECT balance FROM user_wallets WHERE user_id = ?",
                            [dRows[0].User_ID_FK]
                        );
                        if (uwRows.length > 0 && parseFloat(uwRows[0].balance || 0) > 0) {
                            dBalance = parseFloat(uwRows[0].balance);
                        }
                    }

                    return res.json({
                        success: true,
                        data: {
                            balance: parseFloat(dBalance.toFixed(2)),
                            currency: 'PKR',
                            totalCredited: parseFloat(parseFloat(dwStats[0]?.total_credited || 0).toFixed(2)),
                            totalSpent: parseFloat(parseFloat(dwStats[0]?.total_spent || 0).toFixed(2)),
                            totalTransactions: parseInt(dwStats[0]?.total_transactions || 0, 10),
                        }
                    });
                }
            }

            // Fetch or initialize user wallet
            const [rows] = await conn.query(
                `SELECT balance, currency, updated_at FROM user_wallets WHERE user_id = ?`,
                [userId]
            );

            let balance = 0.00;
            let currency = 'PKR';

            if (rows.length === 0) {
                // Initialize wallet for new user
                await conn.query(
                    `INSERT INTO user_wallets (user_id, balance, currency) VALUES (?, 0.00, 'PKR')
                     ON DUPLICATE KEY UPDATE balance = balance`,
                    [userId]
                );
            } else {
                balance = parseFloat(rows[0].balance || 0);
                currency = rows[0].currency || 'PKR';
            }

            // Calculate lifetime stats
            const [stats] = await conn.query(
                `SELECT 
                    COALESCE(SUM(CASE WHEN transaction_type = 'credit' AND status = 'completed' THEN amount ELSE 0 END), 0) as total_credited,
                    COALESCE(SUM(CASE WHEN transaction_type = 'debit' AND status = 'completed' THEN amount ELSE 0 END), 0) as total_spent,
                    COUNT(CASE WHEN status = 'completed' THEN 1 END) as total_transactions
                 FROM user_wallet_transactions 
                 WHERE user_id = ?`,
                [userId]
            );

            res.json({
                success: true,
                data: {
                    balance: parseFloat(balance.toFixed(2)),
                    currency,
                    totalCredited: parseFloat(parseFloat(stats[0]?.total_credited || 0).toFixed(2)),
                    totalSpent: parseFloat(parseFloat(stats[0]?.total_spent || 0).toFixed(2)),
                    totalTransactions: parseInt(stats[0]?.total_transactions || 0, 10),
                }
            });
        } catch (err) {
            console.error('❌ [Wallet] getWalletBalance error:', err);
            res.status(500).json({ success: false, message: 'Failed to retrieve wallet balance', error: err.message });
        } finally {
            if (conn) conn.release();
        }
    },

    /**
     * Get paginated transaction history for user's wallet
     */
    getWalletTransactions: async (req, res) => {
        const userId = req.user?.userId;
        const { type = 'all', page = 1, limit = 20 } = req.query;

        if (!userId) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
        const offset = (pageNum - 1) * limitNum;

        let conn;
        try {
            conn = await pool.getConnection();

            let whereClause = 'WHERE user_id = ?';
            const params = [userId];

            if (type === 'credit' || type === 'debit') {
                whereClause += ' AND transaction_type = ?';
                params.push(type);
            }

            // Get total count
            const [countRows] = await conn.query(
                `SELECT COUNT(*) as total FROM user_wallet_transactions ${whereClause}`,
                params
            );
            const total = countRows[0]?.total || 0;

            // Get transactions
            const [transactions] = await conn.query(
                `SELECT id, amount, transaction_type, payment_method, description, reference_id, ride_id, status, created_at
                 FROM user_wallet_transactions
                 ${whereClause}
                 ORDER BY created_at DESC
                 LIMIT ? OFFSET ?`,
                [...params, limitNum, offset]
            );

            res.json({
                success: true,
                data: {
                    transactions: transactions.map(t => ({
                        ...t,
                        amount: parseFloat(parseFloat(t.amount).toFixed(2))
                    })),
                    pagination: {
                        page: pageNum,
                        limit: limitNum,
                        total,
                        totalPages: Math.ceil(total / limitNum)
                    }
                }
            });
        } catch (err) {
            console.error('❌ [Wallet] getWalletTransactions error:', err);
            res.status(500).json({ success: false, message: 'Failed to retrieve transactions', error: err.message });
        } finally {
            if (conn) conn.release();
        }
    },

    /**
     * Initiate Wallet Top-Up via JazzCash (Card / Mobile Account)
     */
    initiateWalletTopup: async (req, res) => {
        const userId = req.user?.userId;
        const { amount, txnType = 'MIGS', returnUrl } = req.body;

        if (!userId) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const numericAmount = parseFloat(amount);
        if (!numericAmount || numericAmount <= 0 || isNaN(numericAmount)) {
            return res.status(400).json({ success: false, message: 'Please enter a valid top-up amount' });
        }

        if (numericAmount < 10) {
            return res.status(400).json({ success: false, message: 'Minimum top-up amount is PKR 10' });
        }

        let conn;
        try {
            conn = await pool.getConnection();

            const host = req.get('host');
            const protocol = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
            const defaultReturnUrl = `${protocol}://${host}/wallet/topup/callback`;
            const effectiveReturnUrl = returnUrl || defaultReturnUrl;

            const billReference = `TOPUP${userId}${Date.now()}`;
            const description = `GoRide Wallet Topup`;

            const payload = jazzCashService.generatePaymentPayload({
                amount: numericAmount,
                billReference,
                description,
                txnType,
                returnUrl: effectiveReturnUrl,
                customFields: {
                    ppmpf_1: String(userId),
                    ppmpf_2: 'wallet_topup',
                    ppmpf_3: billReference
                }
            });

            // Insert pending record in user_wallet_transactions
            await conn.query(
                `INSERT INTO user_wallet_transactions (
                    user_id, amount, transaction_type, payment_method, description, reference_id, status, created_at
                ) VALUES (?, ?, 'credit', ?, ?, ?, 'pending', NOW())`,
                [
                    userId,
                    numericAmount,
                    (txnType === 'MWALLET' || txnType === 'mobile') ? 'jazzcash_mobile' : 'jazzcash_card',
                    `GoRide Wallet Top-Up PKR ${numericAmount.toFixed(0)}`,
                    payload.txnRefNo
                ]
            );

            const checkoutUrl = `${protocol}://${host}/wallet/topup/checkout/${payload.txnRefNo}`;

            res.json({
                success: true,
                message: 'Top-up initiated successfully',
                data: {
                    txnRefNo: payload.txnRefNo,
                    amount: payload.amount,
                    amountInPaisa: payload.amountInPaisa,
                    html: payload.html,
                    paymentPortalUrl: payload.paymentPortalUrl,
                    postData: payload.postData,
                    checkoutUrl,
                    returnUrl: effectiveReturnUrl
                }
            });

        } catch (err) {
            console.error('❌ [Wallet] initiateWalletTopup error:', err);
            res.status(500).json({ success: false, message: 'Failed to initiate wallet top-up', error: err.message });
        } finally {
            if (conn) conn.release();
        }
    },

    /**
     * Render hosted checkout form directly from server
     */
    checkoutWalletTopup: async (req, res) => {
        const { txnRefNo } = req.params;
        let conn;
        try {
            conn = await pool.getConnection();
            const [txns] = await conn.query(
                `SELECT * FROM user_wallet_transactions WHERE reference_id = ?`,
                [txnRefNo]
            );
            if (txns.length === 0) {
                return res.status(404).send('<h2>Transaction not found</h2>');
            }
            const txn = txns[0];
            const host = req.get('host');
            const protocol = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
            const returnUrl = `${protocol}://${host}/wallet/topup/callback`;

            const payload = jazzCashService.generatePaymentPayload({
                amount: txn.amount,
                billReference: `TOPUP${txn.user_id}${Date.now()}`,
                description: 'GoRide Wallet Topup',
                txnType: txn.payment_method === 'jazzcash_mobile' ? 'MWALLET' : 'MIGS',
                txnRefNo: txn.reference_id,
                returnUrl: returnUrl,
                customFields: {
                    ppmpf_1: String(txn.user_id),
                    ppmpf_2: 'wallet_topup',
                    ppmpf_3: txn.reference_id
                }
            });

            res.setHeader('Content-Type', 'text/html');
            res.send(payload.html);
        } catch (err) {
            console.error('❌ [Wallet] checkoutWalletTopup error:', err);
            res.status(500).send('<h2>Unable to load checkout</h2>');
        } finally {
            if (conn) conn.release();
        }
    },

    /**
     * Verify & complete wallet top-up
     * Called when the app receives successful response from JazzCash WebView
     */
    verifyWalletTopup: async (req, res) => {
        const userId = req.user?.userId;
        const { txnRefNo, responseCode, amount } = req.body;

        if (!userId) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        if (!txnRefNo) {
            return res.status(400).json({ success: false, message: 'Transaction reference is required' });
        }

        const isSuccess = responseCode === '000' || responseCode === '121';
        if (!isSuccess) {
            return res.status(400).json({ success: false, message: 'Payment was not approved by gateway' });
        }

        let conn;
        try {
            conn = await pool.getConnection();
            await conn.beginTransaction();

            // Find transaction
            const [txns] = await conn.query(
                `SELECT * FROM user_wallet_transactions WHERE reference_id = ? AND user_id = ? FOR UPDATE`,
                [txnRefNo, userId]
            );

            if (txns.length === 0) {
                await conn.rollback();
                return res.status(404).json({ success: false, message: 'Transaction record not found' });
            }

            const txn = txns[0];
            const topupAmount = parseFloat(txn.amount || amount || 0);

            if (txn.status === 'completed') {
                // Already credited
                const [wallet] = await conn.query(`SELECT balance FROM user_wallets WHERE user_id = ?`, [userId]);
                await conn.commit();
                return res.json({
                    success: true,
                    message: 'Wallet top-up already processed',
                    data: {
                        balance: parseFloat(parseFloat(wallet[0]?.balance || 0).toFixed(2)),
                        creditedAmount: topupAmount
                    }
                });
            }

            // Update transaction status
            await conn.query(
                `UPDATE user_wallet_transactions SET status = 'completed' WHERE id = ?`,
                [txn.id]
            );

            // Credit wallet balance
            await conn.query(
                `INSERT INTO user_wallets (user_id, balance, currency) VALUES (?, ?, 'PKR')
                 ON DUPLICATE KEY UPDATE balance = balance + ?`,
                [userId, topupAmount, topupAmount]
            );

            // Get updated balance
            const [updatedWallet] = await conn.query(
                `SELECT balance FROM user_wallets WHERE user_id = ?`,
                [userId]
            );

            await conn.commit();

            const newBalance = parseFloat(parseFloat(updatedWallet[0]?.balance || 0).toFixed(2));
            console.log(`✅ [Wallet] User #${userId} topped up PKR ${topupAmount}. New balance: PKR ${newBalance}`);

            res.json({
                success: true,
                message: 'Wallet topped up successfully',
                data: {
                    balance: newBalance,
                    creditedAmount: topupAmount,
                    txnRefNo
                }
            });

        } catch (err) {
            if (conn) await conn.rollback();
            console.error('❌ [Wallet] verifyWalletTopup error:', err);
            res.status(500).json({ success: false, message: 'Failed to verify top-up', error: err.message });
        } finally {
            if (conn) conn.release();
        }
    },

    /**
     * Webhook/Browser Callback for Wallet Top-Up
     */
    handleTopupCallback: async (req, res) => {
        const data = req.method === 'POST' ? req.body : req.query;
        console.log('🔔 [Wallet Topup Callback] Data:', data);

        const {
            pp_ResponseCode,
            pp_ResponseMessage,
            pp_TxnRefNo,
            pp_Amount,
            ppmpf_1: userId
        } = data;

        const isSuccess = pp_ResponseCode === '000' || pp_ResponseCode === '121';
        const formattedAmount = pp_Amount ? (parseInt(pp_Amount, 10) / 100).toFixed(2) : '0.00';

        if (isSuccess && userId && pp_TxnRefNo) {
            let conn;
            try {
                conn = await pool.getConnection();
                await conn.beginTransaction();

                const [txns] = await conn.query(
                    `SELECT id, status, amount FROM user_wallet_transactions WHERE reference_id = ? FOR UPDATE`,
                    [pp_TxnRefNo]
                );

                if (txns.length > 0 && txns[0].status !== 'completed') {
                    const topupAmount = parseFloat(txns[0].amount || formattedAmount);
                    await conn.query(`UPDATE user_wallet_transactions SET status = 'completed' WHERE id = ?`, [txns[0].id]);
                    await conn.query(
                        `INSERT INTO user_wallets (user_id, balance, currency) VALUES (?, ?, 'PKR')
                         ON DUPLICATE KEY UPDATE balance = balance + ?`,
                        [userId, topupAmount, topupAmount]
                    );
                }
                await conn.commit();
            } catch (dbErr) {
                if (conn) await conn.rollback();
                console.error('❌ [Wallet Topup Callback DB Error]:', dbErr);
            } finally {
                if (conn) conn.release();
            }
        }

        const resultJson = JSON.stringify({
            success: isSuccess,
            responseCode: pp_ResponseCode,
            message: pp_ResponseMessage || (isSuccess ? 'Wallet Top-Up Successful' : 'Top-Up Failed'),
            txnRefNo: pp_TxnRefNo,
            amount: formattedAmount,
            userId: userId || null
        });

        const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Wallet Top-Up</title>
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
        }
    </style>
    <script type="text/javascript">
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
        <h2>${isSuccess ? 'Top-Up Successful!' : 'Top-Up Failed'}</h2>
        <p class="desc">${isSuccess ? 'Your wallet has been credited.' : (pp_ResponseMessage || 'The transaction could not be completed.')}</p>
        
        <div class="info-box">
            <div class="info-row">
                <span class="info-label">Amount:</span>
                <span class="info-val">PKR ${formattedAmount}</span>
            </div>
            <div class="info-row">
                <span class="info-label">Transaction Ref:</span>
                <span class="info-val">${pp_TxnRefNo || '-'}</span>
            </div>
        </div>

        <button class="btn" onclick="returnToApp()">Return to Wallet</button>
    </div>
</body>
</html>`;

        res.setHeader('Content-Type', 'text/html');
        return res.send(html);
    }
};

module.exports = walletController;

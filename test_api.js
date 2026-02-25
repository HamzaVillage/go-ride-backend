const axios = require('axios');

(async () => {
    try {
        console.log("Testing GET /sysconfig/get-config...");
        const response = await axios.get('http://localhost:4000/sysconfig/get-config');
        console.log("Response Status:", response.status);
        console.log("Response Data:", JSON.stringify(response.data, null, 2));

        if (response.data.success && response.data.data) {
            const fields = ['ride_service', 'courier_service', 'food_delivery_service', 'grocery_service', 'fare_increaser'];
            const missing = fields.filter(f => response.data.data[f] === undefined);
            if (missing.length === 0) {
                console.log("✅ All requested fields are present.");
            } else {
                console.error("❌ Missing fields:", missing);
            }
        }
    } catch (err) {
        console.error("❌ API Test Failed:", err.message);
        if (err.response) {
            console.error("Response data:", err.response.data);
        }
    }
})();

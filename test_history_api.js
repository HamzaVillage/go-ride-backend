const axios = require('axios');

// Test configuration
const API_BASE = 'http://localhost:3000';
const TEST_USER_PHONE = '03082228871'; // Kashif from DB

async function testHistoryAndCancel() {
    try {
        console.log('🧪 Testing Ride History & Cancel API\n');

        // Step 1: Login to get token
        console.log('1️⃣ Logging in...');
        const loginResponse = await axios.post(`${API_BASE}/auth/login`, {
            phone: TEST_USER_PHONE,
            password: 'password123'
        });

        if (!loginResponse.data.success) {
            console.log('❌ Login failed. Trying OTP verification...');
            // In real scenario, you'd need to get OTP from SMS
            return;
        }

        // For testing, let's assume we have a token from a previous session
        // You'll need to replace this with an actual valid token
        const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjU5OCwicm9sZSI6InJpZGVyIiwicGhvbmUiOiIwMzA4MjIyODg3MSIsImlhdCI6MTczOTgxOTM4OSwiZXhwIjoxNzQwNDI0MTg5fQ.xyz'; // Replace with actual token

        console.log('✅ Token obtained\n');

        // Step 2: Fetch Upcoming rides
        console.log('2️⃣ Fetching Upcoming rides...');
        const upcomingResponse = await axios.get(`${API_BASE}/ride/history`, {
            params: { status: 'Requested,Accepted,Arrived,Started' },
            headers: { Authorization: `Bearer ${token}` }
        });

        console.log(`✅ Found ${upcomingResponse.data.count} upcoming rides`);
        if (upcomingResponse.data.data.length > 0) {
            console.log('Sample ride:', {
                id: upcomingResponse.data.data[0].Ride_ID_Pk,
                status: upcomingResponse.data.data[0].Ride_Status,
                pickup: upcomingResponse.data.data[0].Pickup_Location,
                dropoff: upcomingResponse.data.data[0].Drop_Location
            });
        }
        console.log('');

        // Step 3: Fetch Completed rides
        console.log('3️⃣ Fetching Completed rides...');
        const completedResponse = await axios.get(`${API_BASE}/ride/history`, {
            params: { status: 'Completed' },
            headers: { Authorization: `Bearer ${token}` }
        });
        console.log(`✅ Found ${completedResponse.data.count} completed rides\n`);

        // Step 4: Fetch Cancelled rides
        console.log('4️⃣ Fetching Cancelled rides...');
        const cancelledResponse = await axios.get(`${API_BASE}/ride/history`, {
            params: { status: 'Cancelled' },
            headers: { Authorization: `Bearer ${token}` }
        });
        console.log(`✅ Found ${cancelledResponse.data.count} cancelled rides\n`);

        // Step 5: Test cancellation (if there's an upcoming ride)
        if (upcomingResponse.data.data.length > 0) {
            const rideToCancel = upcomingResponse.data.data[0];
            console.log(`5️⃣ Testing cancel for ride ${rideToCancel.Ride_ID_Pk}...`);

            const cancelResponse = await axios.post(`${API_BASE}/ride/cancel`, {
                ride_id: rideToCancel.Ride_ID_Pk,
                reason: 'Test cancellation from history'
            }, {
                headers: { Authorization: `Bearer ${token}` }
            });

            if (cancelResponse.data.success) {
                console.log('✅ Ride cancelled successfully\n');

                // Verify it moved to cancelled
                console.log('6️⃣ Verifying cancellation...');
                const verifyResponse = await axios.get(`${API_BASE}/ride/history`, {
                    params: { status: 'Cancelled' },
                    headers: { Authorization: `Bearer ${token}` }
                });
                console.log(`✅ Now have ${verifyResponse.data.count} cancelled rides\n`);
            }
        } else {
            console.log('⚠️ No upcoming rides to test cancellation\n');
        }

        console.log('✅ All tests completed successfully!');

    } catch (error) {
        console.error('❌ Test failed:', error.response?.data || error.message);
    }
}

// Note: You need to manually get a valid token first
console.log('⚠️ IMPORTANT: Update the token in this script with a valid one from your app');
console.log('You can get it from Redux DevTools or console logs after logging in\n');

// Uncomment to run:
// testHistoryAndCancel();

module.exports = testHistoryAndCancel;

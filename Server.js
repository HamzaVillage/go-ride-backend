const express = require("express");
const cors = require("cors");
const http = require("http");
const Connect_Db = require("./db/Connect_Db");
const { initSocket } = require("./socket/socketManager");
const userRoutes = require('./routers/users');
const authRoutes = require('./routers/auth');
const fareRoutes = require('./routers/fare');
const rideRoutes = require('./routers/ride');
const addressRoutes = require('./routers/address');

const app = express();
const server = http.createServer(app);

// Initialize Socket.IO
initSocket(server);

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.get("/", (req, res) => {
    res.send("Welcome to the GoRide API!");
});

app.use("/auth", authRoutes);
app.use("/user", userRoutes);
app.use("/fare", fareRoutes);
app.use("/ride", rideRoutes);
app.use("/address", addressRoutes);


// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
});

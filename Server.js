const express = require("express");
const cors = require("cors");
const Connect_Db = require("./db/Connect_Db");
const userRoutes = require('./routers/users');
const authRoutes = require('./routers/auth');
const fareRoutes = require('./routers/fare');
const rideRoutes = require('./routers/ride');

const app = express();

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


// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
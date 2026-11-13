const express = require("express"),
  jwt = require("jsonwebtoken"),
  axios = require("axios"),
  FormData = require("form-data");
const auth = require("../utils/authMiddleware");
const { resolveCityToCityIdentity } = require("../services/cityToCityIdentity");
const { createMobileAuth } = require("../services/mobileAuth");
const {
  createCityToCityDrivers,
  fail,
} = require("../services/cityToCityDrivers");
module.exports = function createMobileAuthRouter(pool) {
  const router = express.Router();
  const service = createMobileAuth({
    pool,
    sendOtp: async (phone) => {
      const form = new FormData();
      form.append("mobile", phone);
      const response = await axios.post(
        "https://nexuscodelab.com/calling/send_otp.php",
        form,
        { headers: form.getHeaders(), timeout: 10000 }
      );
      if (!response.data?.sent || !response.data?.opt)
        throw fail(502, "Unable to send verification code.");
      return response.data.opt;
    },
    signToken: (claims) => {
      if (!process.env.JWT_SECRET)
        throw fail(503, "Sign-in is temporarily unavailable.");
      return jwt.sign(claims, process.env.JWT_SECRET, { expiresIn: "30d" });
    },
  });
  const handle = (action) => async (req, res) => {
    try {
      res.set("Cache-Control", "no-store, private");
      res.json({ success: true, ...(await action(req)) });
    } catch (e) {
      if (!e.status)
        console.error(
          "Mobile authentication failed:",
          e.code || "INTERNAL_ERROR"
        );
      res.status(e.status || 500).json({
        success: false,
        message: e.status
          ? e.message
          : "Unable to complete sign-in. Please try again.",
        account_deleted: e.account_deleted || undefined,
      });
    }
  };
  router.post(
    "/mobile-login",
    handle((req) => service.send(req.body))
  );
  router.post(
    "/mobile-register",
    handle((req) => service.send(req.body, true))
  );
  router.post(
    "/mobile-verify-otp",
    handle((req) => service.verify(req.body))
  );
  router.post(
    "/mobile-mode",
    auth,
    handle(async (req) => {
      const identity = await resolveCityToCityIdentity(pool, req.user);
      const result = await createCityToCityDrivers(pool).switchMode(
        identity.userId,
        req.body?.mode
      );
      return {
        data: result,
        ...(!result.needs_onboarding
          ? { session: await service.session(identity.userId, req.body.mode) }
          : {}),
      };
    })
  );
  return router;
};

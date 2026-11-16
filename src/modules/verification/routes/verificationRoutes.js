import express from "express";

import { authenticate } from "../../../middleware/authMiddleware.js";

import {
  getMyVerificationStatus,
  startSandboxVerification,
  runSandboxVerification,
  getDemoBookingVerification,
} from "../controllers/verificationController.js";

const router = express.Router();

router.use(authenticate);

// Retrieve the authenticated customer's verification status.
router.get("/me", getMyVerificationStatus);

// Start a sandbox-only NIN verification session.
router.post("/start", startSandboxVerification);

router.post("/demo/run", runSandboxVerification);

router.get(
  "/demo/bookings/:bookingId/preview",
  getDemoBookingVerification
);

export default router;
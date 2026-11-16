import express from "express";

import { authenticate } from "../middleware/authMiddleware.js";
import {
  initializeTestPayment,
  verifyTestPayment,
  getMyTestPayments,
} from "../controllers/paymentController.js";

const router = express.Router();

router.use(authenticate);

router.post("/test/bookings/:bookingId/initialize", initializeTestPayment);

router.get("/test/:reference/verify", verifyTestPayment);

router.get("/test/my", getMyTestPayments);

export default router;

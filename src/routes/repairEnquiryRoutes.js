import express from "express";
import { rateLimit } from "express-rate-limit";

import {
  createRepairEnquiry,
  getRepairEnquiries,
  updateRepairEnquiryStatus,
} from "../controllers/repairEnquiryController.js";

import { authenticate } from "../middleware/authMiddleware.js";
import { authorize } from "../middleware/authorize.js";

const router = express.Router();

const enquiryLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    success: false,
    message:
      "Too many service enquiries. Please try again later.",
  },
});

// Public service enquiry submission.
router.post("/", enquiryLimiter, createRepairEnquiry);

// Admin-only enquiry listing.
router.get(
  "/",
  authenticate,
  authorize("admin"),
  getRepairEnquiries
);

// Admin-only status updates.
router.patch(
  "/:id/status",
  authenticate,
  authorize("admin"),
  updateRepairEnquiryStatus
);

export default router;
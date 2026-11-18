import express from "express";
import { rateLimit } from "express-rate-limit";

import {
  createContactEnquiry,
  getContactEnquiries,
} from "../controllers/contactController.js";

import { authenticate } from "../middleware/authMiddleware.js";
import { authorize } from "../middleware/authorize.js";

const router = express.Router();

const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    success: false,
    message:
      "Too many enquiries. Please try again later.",
  },
});

// Anyone can submit an enquiry.
router.post("/", contactLimiter, createContactEnquiry);

// Only an administrator can read submissions.
router.get(
  "/",
  authenticate,
  authorize("admin"),
  getContactEnquiries
);

export default router;
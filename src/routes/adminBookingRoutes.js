import express from "express";

import {
  getAdminBookings,
  approveBooking,
  rejectBooking,
} from "../controllers/adminBookingController.js";

import {
  authenticate,
} from "../middleware/authMiddleware.js";

import {
  authorize,
} from "../middleware/authorize.js";

const router = express.Router();

// All routes require administrator privileges.
router.use(authenticate, authorize("admin"));

// Retrieve customer booking requests
router.get("/", getAdminBookings);

// Provisionally approve a request
router.patch("/:id/approve", approveBooking);

// Reject a request
router.patch("/:id/reject", rejectBooking);

export default router;
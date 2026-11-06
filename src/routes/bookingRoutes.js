import express from "express";

import {
  getRentalQuote,
  createBookingRequest,
  getMyBookings,
  getMyBookingById,
} from "../controllers/bookingController.js";

import {
  authenticate,
} from "../middleware/authMiddleware.js";

const router = express.Router();

// Public: Calculate rental quotation
router.post("/quote", getRentalQuote);

// Protected: Submit a new booking request
router.post("/", authenticate, createBookingRequest);

// Protected: Retrieve the customer's booking history
router.get("/my", authenticate, getMyBookings);

// Protected: Retrieve one booking belonging to the customer
router.get("/:id", authenticate, getMyBookingById);

export default router;
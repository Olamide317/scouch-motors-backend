import express from "express";

import { getRentalQuote } from "../controllers/bookingController.js";

const router = express.Router();

// Public rental quotation
router.post("/quote", getRentalQuote);

export default router;
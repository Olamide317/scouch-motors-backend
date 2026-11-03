import express from "express";

import {
  getPricingPolicy,
  updatePricingPolicy,
} from "../controllers/pricingSettingsController.js";

import { authenticate } from "../middleware/authMiddleware.js";
import { authorize } from "../middleware/authorize.js";

const router = express.Router();

router.use(authenticate, authorize("admin"));

router.get("/", getPricingPolicy);
router.patch("/", updatePricingPolicy);

export default router;
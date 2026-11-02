import express from "express";

import {
  createVehicle,
  getVehicles,
  getVehicleById,
  updateVehicle,
} from "../controllers/vehicleController.js";

import { authenticate } from "../middleware/authMiddleware.js";
import { authorize } from "../middleware/authorize.js";

const router = express.Router();

// Public routes
router.get("/", getVehicles);
router.get("/:id", getVehicleById);

// Admin-only routes
router.post(
  "/",
  authenticate,
  authorize("admin"),
  createVehicle
);

// Admin-only vehicle update
router.patch(
  "/:id",
  authenticate,
  authorize("admin"),
  updateVehicle
);

export default router;
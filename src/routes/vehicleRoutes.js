import express from "express";

import {
  createVehicle,
  getVehicles,
  getVehicleById,
  updateVehicle,
  deactivateVehicle,
  activateVehicle,
  updateVehicleStatus,
} from "../controllers/vehicleController.js";

import { authenticate } from "../middleware/authMiddleware.js";
import { authorize } from "../middleware/authorize.js";

import {
  getVehicleAvailability,
} from "../controllers/vehicleAvailabilityController.js";

const router = express.Router();

// Public vehicle routes
router.get("/", getVehicles);

// Check vehicle availability for selected dates
router.get("/:id/availability", getVehicleAvailability);

// Retrieve one vehicle
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

// Admin-only vehicle deactivation
router.patch(
  "/:id/deactivate",
  authenticate,
  authorize("admin"),
  deactivateVehicle
);

// Admin-only vehicle activation
router.patch(
  "/:id/activate",
  authenticate,
  authorize("admin"),
  activateVehicle
);

// Admin-only operational status management
router.patch(
  "/:id/status",
  authenticate,
  authorize("admin"),
  updateVehicleStatus
);

export default router;
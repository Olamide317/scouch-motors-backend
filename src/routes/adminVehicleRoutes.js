import express from "express";

import { authenticate } from "../middleware/authMiddleware.js";
import { authorize } from "../middleware/authorize.js";

import { getAdminVehicles } from "../controllers/vehicleController.js";
import {
  createAvailabilityBlock,
  getVehicleAvailabilityBlocks,
  deactivateAvailabilityBlock,
} from "../controllers/adminAvailabilityController.js";


const router = express.Router();

// All routes in this router require admin access.
router.use(authenticate, authorize("admin"));

// Retrieve full vehicle inventory.
router.get("/vehicles", getAdminVehicles);

// Schedule vehicle maintenance or other restrictions
router.post(
  "/vehicles/:id/availability-blocks",
  createAvailabilityBlock
);

// View all availability blocks for a vehicle
router.get(
  "/vehicles/:id/availability-blocks",
  getVehicleAvailabilityBlocks
);

// Deactivate an existing availability block
router.patch(
  "/availability-blocks/:blockId/deactivate",
  deactivateAvailabilityBlock
);

export default router;
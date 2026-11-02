import express from "express";

import { getAdminVehicles } from "../controllers/vehicleController.js";
import { authenticate } from "../middleware/authMiddleware.js";
import { authorize } from "../middleware/authorize.js";

const router = express.Router();

// All routes in this router require admin access.
router.use(authenticate, authorize("admin"));

// Retrieve full vehicle inventory.
router.get("/vehicles", getAdminVehicles);

export default router;
import express from "express";
import { authorize } from "../middleware/authorize.js";

import {
  registerUser,
  loginUser,
  getCurrentUser,
} from "../controllers/authController.js";

import { authenticate } from "../middleware/authMiddleware.js";

const router = express.Router();

// Public routes
router.post("/register", registerUser);
router.post("/login", loginUser);

// Protected route
router.get("/me", authenticate, getCurrentUser);
// Temporary endpoint for testing admin permissions
router.get("/admin-check", authenticate, authorize("admin"), (req, res) => {
  res.status(200).json({
    success: true,
    message: "Admin access granted",
  });
});

export default router;
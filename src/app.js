import express from "express";
import cors from "cors";
import helmet from "helmet";
import authRoutes from "./routes/authRoutes.js";
import vehicleRoutes from "./routes/vehicleRoutes.js";
import adminVehicleRoutes from "./routes/adminVehicleRoutes.js";
import adminPricingRoutes from "./routes/adminPricingRoutes.js";
import bookingRoutes from "./routes/bookingRoutes.js";
import adminBookingRoutes from "./routes/adminBookingRoutes.js";
import verificationRoutes from "./modules/verification/routes/verificationRoutes.js";
import paymentRoutes from "./routes/paymentRoutes.js";
import { handlePaystackTestWebhook } from "./controllers/paymentWebhookController.js";
import contactRoutes from "./routes/contactRoutes.js";

const app = express();

app.use(helmet());

app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:5173",
  }),
);

// Paystack must receive the raw request body.
// This route uses signature authentication, not JWT.
app.post(
  "/api/payments/webhook",
  express.raw({
    type: "application/json",
    limit: "256kb",
  }),
  handlePaystackTestWebhook,
);

app.use(express.json());

app.use(express.json());

// Health check
app.get("/api/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Scouch Motors API is running",
  });
});

// Authentication routes
app.use("/api/auth", authRoutes);

app.use("/api/vehicles", vehicleRoutes);

app.use("/api/admin", adminVehicleRoutes);

app.use("/api/admin/pricing-policy", adminPricingRoutes);

app.use("/api/bookings", bookingRoutes);

app.use("/api/admin/bookings", adminBookingRoutes);

// Identity verification routes
app.use("/api/verification", verificationRoutes);

app.use("/api/payments", paymentRoutes);

app.use("/api/contact", contactRoutes);

export default app;
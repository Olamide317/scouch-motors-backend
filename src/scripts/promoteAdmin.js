import "dotenv/config";
import mongoose from "mongoose";
import User from "../models/User.js";
import connectDB from "../config/db.js";

const promoteAdmin = async () => {
  try {
    const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();

    if (!email) {
      throw new Error("ADMIN_EMAIL is required");
    }

    await connectDB();

    const user = await User.findOne({ email });

    if (!user) {
      throw new Error("User not found");
    }

    if (!user.isActive) {
      throw new Error("Cannot promote an inactive account");
    }

    if (user.role === "admin") {
      console.log("Account is already an administrator");
      return;
    }

    user.role = "admin";
    await user.save();

    console.log("Administrator role assigned successfully");
  } catch (error) {
    console.error("Admin promotion failed:", error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};

promoteAdmin();
import "dotenv/config";
import mongoose from "mongoose";

import connectDB from "./src/config/db.js";
import {
  checkVehicleAvailability,
} from "./src/services/availabilityService.js";

const vehicleId = process.argv[2];

const testAvailability = async () => {
  try {
    if (!vehicleId) {
      throw new Error(
        "Provide a vehicle ID as a command-line argument"
      );
    }

    await connectDB();

    // Use a three-day period starting seven days from now.
    const pickupAt = new Date(
      Date.now() + 7 * 24 * 60 * 60 * 1000
    );

    const returnAt = new Date(
      pickupAt.getTime() + 3 * 24 * 60 * 60 * 1000
    );

    const result = await checkVehicleAvailability({
      vehicleId,
      pickupAt,
      returnAt,
    });

    console.log("Availability result:", result);
  } catch (error) {
    console.error("Availability test failed:", error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};

testAvailability();
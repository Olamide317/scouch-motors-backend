import "dotenv/config";

import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import mongoose from "mongoose";

import connectDB from "../config/db.js";
import cloudinary from "../config/cloudinary.js";
import Vehicle from "../models/Vehicle.js";

// Assumes the frontend lives at scouch-motors/
// and the backend lives at scouch-motors/backend/
const assetDirectory = fileURLToPath(
  new URL("../../../frontend/src/assets/vehicles/", import.meta.url),
);

const demoVehicles = [
  {
    code: "DEMO-SC-001",
    brand: "Lexus",
    model: "IS 350",
    category: "sedan",
    year: 2021,
    file: "lexus-is-350.png",
    daily: 150000,
    description:
      "A premium sports sedan with responsive handling, comfortable seating and a refined interior.",
  },
  {
    code: "DEMO-SC-002",
    brand: "Lexus",
    model: "LS",
    category: "sedan",
    year: 2022,
    file: "lexus-ls.png",
    daily: 90000,
    description:
      "A spacious luxury sedan designed for smooth travel and premium comfort.",
  },
  {
    code: "DEMO-SC-003",
    brand: "Lexus",
    model: "ES 350",
    category: "sedan",
    year: 2019,
    file: "lexus-es-350.png",
    daily: 60000,
    description:
      "An elegant sedan suited to everyday travel, business trips and leisure journeys.",
  },
  {
    code: "DEMO-SC-004",
    brand: "Lexus",
    model: "IS 250",
    category: "sedan",
    year: 2021,
    file: "lexus-is-250.png",
    daily: 150000,
    description:
      "A compact luxury sedan combining everyday practicality with a comfortable cabin.",
  },
  {
    code: "DEMO-SC-005",
    brand: "Bentley",
    model: "Bentayga",
    category: "luxury",
    year: 2026,
    file: "bentley-bentayga.png",
    daily: 400000,
    description:
      "A premium luxury SUV with a spacious interior and refined comfort.",
  },
  {
    code: "DEMO-SC-006",
    brand: "Bentley",
    model: "Flying Spur",
    category: "luxury",
    year: 2024,
    file: "bentley-flying-spur.png",
    daily: 350000,
    description:
      "A sophisticated luxury sedan offering premium cabin comfort and elegant styling.",
  },
];

async function main() {
  const apply = process.argv.includes("--apply");

  // Require explicit authorization for every database write,
  // even when running locally against the production database.
  if (apply && process.env.CONFIRM_PRODUCTION_DEMO_SEED !== "YES") {
    throw new Error(
      "Production database seeding requires explicit authorization.",
    );
  }

  // Verify every source image exists before uploading.
  for (const demo of demoVehicles) {
    await access(path.join(assetDirectory, demo.file));
  }

  // Dry run: inspect files without changing anything.
  if (!apply) {
    console.log("DRY RUN: All image files were found.");

    for (const demo of demoVehicles) {
      console.log(`- ${demo.code}: ${demo.brand} ${demo.model}`);
    }

    console.log("No Cloudinary uploads or database writes performed.");

    return;
  }

  // Require explicit confirmation for database changes.
  if (process.env.CONFIRM_DEMO_SEED !== "YES") {
    throw new Error("Set CONFIRM_DEMO_SEED=YES to authorize seeding.");
  }

  // Confirm our local model includes the required fields.
  for (const field of ["isDemo", "imageAssets", "climateControl"]) {
    if (!Vehicle.schema.path(field)) {
      throw new Error(`Vehicle schema is missing: ${field}`);
    }
  }

  await connectDB();

  try {
    // Make sure we are connected to the intended database.
    const expectedDatabase = process.env.SEED_TARGET_DB?.trim();

    const connectedDatabase = mongoose.connection.name;

    if (!expectedDatabase || connectedDatabase !== expectedDatabase) {
      throw new Error(
        `Database mismatch. Expected "${expectedDatabase}", ` +
          `but connected to "${connectedDatabase}".`,
      );
    }

    console.log(`Verified target database: ${connectedDatabase}`);

    for (const demo of demoVehicles) {
      // Skip previously seeded records.
      const existing = await Vehicle.findOne({
        registrationNumber: demo.code,
      });

      if (existing) {
        if (!existing.isDemo) {
          throw new Error(`${demo.code} belongs to a non-demo vehicle.`);
        }

        console.log(`SKIP: ${demo.brand} ${demo.model}`);

        continue;
      }

      console.log(`Uploading ${demo.brand} ${demo.model}...`);

      const uploaded = await cloudinary.uploader.upload(
        path.join(assetDirectory, demo.file),
        {
          folder: "scouch-motors/demo-fleet",
          public_id: `${demo.code.toLowerCase()}-${randomUUID().slice(0, 8)}`,
          overwrite: false,
          resource_type: "image",
        },
      );

      try {
        await Vehicle.create({
          brand: demo.brand,
          model: demo.model,
          category: demo.category,
          year: demo.year,

          // Internal demonstration identifier.
          registrationNumber: demo.code,

          transmission: "automatic",
          fuelType: "petrol",
          seats: 5,
          climateControl: "A/C",

          description: demo.description,

          images: [uploaded.secure_url],

          imageAssets: [
            {
              url: uploaded.secure_url,
              publicId: uploaded.public_id,
            },
          ],

          pricing: {
            daily: demo.daily,
            weekly: demo.daily * 6,
            monthly: demo.daily * 24,
            currency: "NGN",
          },

          isDemo: true,
          isActive: true,
          operationalStatus: "available",
        });
      } catch (error) {
        // Clean up the newly uploaded asset if
        // MongoDB fails to save the vehicle.
        try {
          await cloudinary.uploader.destroy(uploaded.public_id);
        } catch (cleanupError) {
          console.error("Cloudinary cleanup failed:", cleanupError.message);
        }

        throw error;
      }

      console.log(`CREATED: ${demo.brand} ${demo.model}`);
    }
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error("Demo seeding failed:", error.message);

  process.exitCode = 1;
});

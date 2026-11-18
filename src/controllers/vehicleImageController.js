import { Readable } from "node:stream";

import Vehicle from "../models/Vehicle.js";
import cloudinary from "../config/cloudinary.js";

// Check actual file signatures instead of
// trusting the uploaded MIME type alone.
function hasValidImageSignature(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) {
    return false;
  }

  const isJpeg =
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff;

  const isPng =
    buffer.subarray(0, 8).equals(
      Buffer.from([
        137, 80, 78, 71, 13, 10, 26, 10,
      ])
    );

  const isWebp =
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP";

  return isJpeg || isPng || isWebp;
}

// Upload one image from memory to Cloudinary.
function uploadToCloudinary(buffer, folder) {
  return new Promise((resolve, reject) => {
    const uploadStream =
      cloudinary.uploader.upload_stream(
        {
          folder,
          resource_type: "image",
          overwrite: false,
        },
        (error, result) => {
          if (error) {
            return reject(error);
          }

          resolve(result);
        }
      );

    Readable.from([buffer])
      .on("error", reject)
      .pipe(uploadStream);
  });
}

// POST /api/vehicles/:id/images
export async function uploadVehicleImage(req, res) {
  const { id } = req.params;

  if (!/^[a-fA-F0-9]{24}$/.test(id)) {
    return res.status(400).json({
      success: false,
      message: "Invalid vehicle ID.",
    });
  }

  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: "An image file is required.",
    });
  }

  if (!hasValidImageSignature(req.file.buffer)) {
    return res.status(400).json({
      success: false,
      message: "Invalid image file.",
    });
  }

  let uploadedPublicId = null;

  try {
    // Admins may upload images to existing vehicles,
    // including temporarily inactive vehicles.
    const vehicle = await Vehicle.findById(id).select(
      "+imageAssets"
    );

    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message: "Vehicle not found.",
      });
    }

    // Store vehicle images inside their own folder.
    const folder = `scouch-motors/vehicles/${vehicle.id}`;

    const uploaded = await uploadToCloudinary(
      req.file.buffer,
      folder
    );

    if (
      !uploaded?.public_id ||
      typeof uploaded.secure_url !== "string" ||
      !uploaded.secure_url.startsWith("https://")
    ) {
      throw new Error("Invalid Cloudinary upload response.");
    }

    uploadedPublicId = uploaded.public_id;

    // Preserve existing image URLs.
    vehicle.images.push(uploaded.secure_url);

    // Preserve Cloudinary metadata for future management.
    vehicle.imageAssets.push({
      url: uploaded.secure_url,
      publicId: uploaded.public_id,
    });

    await vehicle.save();

    return res.status(201).json({
      success: true,
      message: "Vehicle image uploaded successfully.",

      image: {
        url: uploaded.secure_url,
        publicId: uploaded.public_id,
      },

      vehicleId: vehicle.id,
      totalImages: vehicle.images.length,
    });
  } catch (error) {
    // Avoid leaving an orphaned Cloudinary asset
    // if the MongoDB update fails.
    if (uploadedPublicId) {
      try {
        await cloudinary.uploader.destroy(
          uploadedPublicId,
          { resource_type: "image" }
        );
      } catch (cleanupError) {
        console.error(
          "Cloudinary cleanup failed:",
          cleanupError
        );
      }
    }

    console.error(
      "Vehicle image upload failed:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Unable to upload vehicle image.",
    });
  }
}
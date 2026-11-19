import { Readable } from "node:stream";

import Vehicle from "../models/Vehicle.js";
import cloudinary from "../config/cloudinary.js";

// Check actual file signatures instead of
// trusting the uploaded MIME type alone.
function hasValidImageSignature(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) {
    return false;
  }

  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;

  const isPng = buffer
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));

  const isWebp =
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP";

  return isJpeg || isPng || isWebp;
}

// Upload one image from memory to Cloudinary.
function uploadToCloudinary(buffer, folder) {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
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
      },
    );

    Readable.from([buffer]).on("error", reject).pipe(uploadStream);
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
    const vehicle = await Vehicle.findById(id).select("+imageAssets");

    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message: "Vehicle not found.",
      });
    }

    // Store vehicle images inside their own folder.
    const folder = `scouch-motors/vehicles/${vehicle.id}`;

    const uploaded = await uploadToCloudinary(req.file.buffer, folder);

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
        await cloudinary.uploader.destroy(uploadedPublicId, {
          resource_type: "image",
        });
      } catch (cleanupError) {
        console.error("Cloudinary cleanup failed:", cleanupError);
      }
    }

    console.error("Vehicle image upload failed:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to upload vehicle image.",
    });
  }
}

export async function setVehicleCoverImage(req, res) {
  try {
    const { id } = req.params;
    const { url } = req.body ?? {};

    if (!/^[a-fA-F0-9]{24}$/.test(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid vehicle ID.",
      });
    }

    if (typeof url !== "string" || !url) {
      return res.status(400).json({
        success: false,
        message: "A vehicle image URL is required.",
      });
    }

    const vehicle = await Vehicle.findById(id).select("images");

    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message: "Vehicle not found.",
      });
    }

    const currentImages = [...vehicle.images];
    const imageIndex = currentImages.indexOf(url);

    if (imageIndex === -1) {
      return res.status(400).json({
        success: false,
        message: "This image does not belong to the vehicle.",
      });
    }

    if (imageIndex === 0) {
      return res.status(200).json({
        success: true,
        message: "This image is already the cover.",
        coverImage: url,
        images: currentImages,
      });
    }

    const reorderedImages = [
      url,
      ...currentImages.filter((_, index) => index !== imageIndex),
    ];

    // Reject the update if another administrator changed
    // the image array after we retrieved it.
    const updatedVehicle = await Vehicle.findOneAndUpdate(
      { _id: id, images: currentImages },
      { $set: { images: reorderedImages } },
      { new: true, runValidators: true },
    ).select("images");

    if (!updatedVehicle) {
      return res.status(409).json({
        success: false,
        message: "Vehicle images changed. Refresh and try again.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Vehicle cover image updated.",
      coverImage: updatedVehicle.images[0],
      images: updatedVehicle.images,
    });
  } catch (error) {
    console.error("Set vehicle cover image failed:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to update vehicle cover image.",
    });
  }
}

export async function deleteVehicleImage(req, res) {
  const { id } = req.params;
  const { url } = req.body ?? {};

  if (!/^[a-fA-F0-9]{24}$/.test(id)) {
    return res.status(400).json({
      success: false,
      message: "Invalid vehicle ID.",
    });
  }

  if (typeof url !== "string" || !url || url.length > 2048) {
    return res.status(400).json({
      success: false,
      message: "A valid vehicle image URL is required.",
    });
  }

  try {
    const vehicle = await Vehicle.findById(id).select(
      "images isActive +imageAssets",
    );

    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message: "Vehicle not found.",
      });
    }

    const currentImages = [...vehicle.images];

    if (!currentImages.includes(url)) {
      return res.status(404).json({
        success: false,
        message: "Image not found on this vehicle.",
      });
    }

    const remainingImages = currentImages.filter((image) => image !== url);

    // Do not leave an active public listing without photos.
    if (vehicle.isActive && remainingImages.length === 0) {
      return res.status(409).json({
        success: false,
        message: "Deactivate the listing before removing its last image.",
      });
    }

    const assets = vehicle.imageAssets ?? [];
    const managedAsset = assets.find((asset) => asset.url === url);

    const remainingAssets = assets
      .filter((asset) => asset.url !== url)
      .map((asset) => ({
        url: asset.url,
        publicId: asset.publicId,
      }));

    // The image array must still match the one we read.
    // This protects against concurrent cover or upload changes.
    const updated = await Vehicle.findOneAndUpdate(
      {
        _id: id,
        images: currentImages,
        isActive: vehicle.isActive,
      },
      {
        $set: {
          images: remainingImages,
          imageAssets: remainingAssets,
        },
      },
      {
        new: true,
        runValidators: true,
      },
    ).select("images");

    if (!updated) {
      return res.status(409).json({
        success: false,
        message: "Vehicle images changed. Refresh and try again.",
      });
    }

    let cleanupStatus = "not_managed";

    if (managedAsset) {
      cleanupStatus = "needs_attention";

      const publicId = managedAsset.publicId;
      const expectedPrefix = `scouch-motors/vehicles/${id}/`;

      if (typeof publicId === "string" && publicId.startsWith(expectedPrefix)) {
        try {
          const result = await cloudinary.uploader.destroy(publicId, {
            resource_type: "image",
            invalidate: true,
          });

          if (result?.result === "ok" || result?.result === "not found") {
            cleanupStatus = "deleted";
          }
        } catch (cleanupError) {
          console.error("Cloudinary cleanup failed:", cleanupError);
        }
      }

      if (cleanupStatus === "needs_attention") {
        console.error("Manual image cleanup required:", {
          vehicleId: id,
          publicId,
        });
      }
    }

    const messages = {
      deleted: "Image removed from the listing and Cloudinary.",
      not_managed:
        "Image removed from the listing. Its external source was not deleted.",
      needs_attention:
        "Image removed from the listing, but Cloudinary cleanup requires attention.",
    };

    return res.status(200).json({
      success: true,
      message: messages[cleanupStatus],
      images: updated.images,
      cleanupStatus,
    });
  } catch (error) {
    console.error("Delete vehicle image failed:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to remove the vehicle image.",
    });
  }
}

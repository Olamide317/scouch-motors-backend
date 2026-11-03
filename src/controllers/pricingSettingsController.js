import { StatusCodes } from "http-status-codes";
import BusinessSettings from "../models/BusinessSettings.js";

const getOrCreateSettings = () => {
  return BusinessSettings.findOneAndUpdate(
    { key: "primary" },
    { $setOnInsert: { key: "primary" } },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    }
  );
};

export const getPricingPolicy = async (req, res) => {
  try {
    const settings = await getOrCreateSettings();

    return res.status(StatusCodes.OK).json({
      success: true,
      pricingPolicy: settings.pricingPolicy,
    });
  } catch (error) {
    console.error("Get pricing policy error:", error);

    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Unable to retrieve pricing policy",
    });
  }
};

export const updatePricingPolicy = async (req, res) => {
  try {
    const updates = req.body;

    if (
      !updates ||
      typeof updates !== "object" ||
      Array.isArray(updates) ||
      Object.keys(updates).length === 0
    ) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: "Provide pricing settings to update",
      });
    }

    const allowedFields = [
      "minimumRentalDays",
      "maximumRentalDays",
      "weeklyDays",
      "monthlyDays",
      "allowPackageUpgrade",
    ];

    if (
      Object.keys(updates).some(
        (field) => !allowedFields.includes(field)
      )
    ) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: "Unsupported pricing policy field",
      });
    }

    for (const [field, value] of Object.entries(updates)) {
      const valid =
        field === "allowPackageUpgrade"
          ? typeof value === "boolean"
          : Number.isSafeInteger(value);

      if (!valid) {
        return res.status(StatusCodes.BAD_REQUEST).json({
          success: false,
          message: `Invalid value for ${field}`,
        });
      }
    }

    const settings = await getOrCreateSettings();

    settings.pricingPolicy.set(updates);

    // Runs schema validation, including cross-field checks.
    await settings.save();

    return res.status(StatusCodes.OK).json({
      success: true,
      message: "Pricing policy updated successfully",
      pricingPolicy: settings.pricingPolicy,
    });
  } catch (error) {
    if (error.name === "ValidationError") {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: Object.values(error.errors)
          .map((item) => item.message)
          .join(", "),
      });
    }

    console.error("Update pricing policy error:", error);

    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Unable to update pricing policy",
    });
  }
};
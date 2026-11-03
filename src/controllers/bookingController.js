import { StatusCodes } from "http-status-codes";

import Vehicle from "../models/Vehicle.js";
import BusinessSettings from "../models/BusinessSettings.js";
import { calculateBestRentalRate } from "../services/pricingService.js";

export const getRentalQuote = async (req, res) => {
  try {
    const { vehicleId, pickupAt, returnAt } = req.body ?? {};

    // 1. Validate the vehicle ID
    if (
      typeof vehicleId !== "string" ||
      !/^[a-fA-F0-9]{24}$/.test(vehicleId)
    ) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: "A valid vehicle ID is required",
      });
    }

    // 2. Require timestamps with explicit time zones
    const timestampPattern =
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

    if (
      typeof pickupAt !== "string" ||
      typeof returnAt !== "string" ||
      !timestampPattern.test(pickupAt) ||
      !timestampPattern.test(returnAt)
    ) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: "Valid pickup and return timestamps are required",
      });
    }

    const pickupDate = new Date(pickupAt);
    const returnDate = new Date(returnAt);

    if (
      Number.isNaN(pickupDate.getTime()) ||
      Number.isNaN(returnDate.getTime()) ||
      pickupDate <= new Date() ||
      returnDate <= pickupDate
    ) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: "Choose valid future rental dates",
      });
    }

    // 3. Retrieve the active vehicle listing
    const vehicle = await Vehicle.findOne({
      _id: vehicleId,
      isActive: true,
    })
      .select("brand model year category pricing operationalStatus")
      .lean();

    if (!vehicle) {
      return res.status(StatusCodes.NOT_FOUND).json({
        success: false,
        message: "Vehicle not found",
      });
    }

    // 4. Retrieve administrator pricing settings
    const settings = await BusinessSettings.findOne({
      key: "primary",
    });

    // Use model defaults if settings haven't been saved yet
    const policy =
      settings?.pricingPolicy ??
      new BusinessSettings({ key: "primary" }).pricingPolicy;

    // 5. Calculate the best rental price
    let quote;

    try {
      quote = calculateBestRentalRate({
        pickupAt,
        returnAt,
        rates: vehicle.pricing,
        policy,
      });
    } catch (error) {
      if (error.message.startsWith("Rental duration must be between")) {
        return res.status(StatusCodes.BAD_REQUEST).json({
          success: false,
          message: error.message,
        });
      }

      throw error;
    }

    // 6. Return the rental-only quotation
    return res.status(StatusCodes.OK).json({
      success: true,
      message: "Rental price calculated successfully",

      vehicle: {
        id: vehicle._id,
        brand: vehicle.brand,
        model: vehicle.model,
        year: vehicle.year,
        category: vehicle.category,
        operationalStatus: vehicle.operationalStatus,
      },

      rentalPeriod: {
        pickupAt: pickupDate.toISOString(),
        returnAt: returnDate.toISOString(),
        rentalDays: quote.rentalDays,
      },

      pricing: {
        currency: "NGN",
        ratePlan: quote.ratePlan,
        ratesSnapshot: quote.ratesSnapshot,
        rateBreakdown: quote.rateBreakdown,
        rentalAmount: quote.rentalAmount,
      },

      availabilityChecked: false,
      quotationType: "rental_only",
    });
  } catch (error) {
    console.error("Rental quotation error:", error);

    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Unable to calculate rental quotation",
    });
  }
};
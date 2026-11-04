import { StatusCodes } from "http-status-codes";

import {
  checkVehicleAvailability,
} from "../services/availabilityService.js";

export const getVehicleAvailability = async (req, res) => {
  try {
    const { id } = req.params;
    const { pickupAt, returnAt } = req.query;

    // 1. Validate the vehicle ID
    if (!/^[a-fA-F0-9]{24}$/.test(id)) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: "Invalid vehicle ID",
      });
    }

    // 2. Validate timestamp format and timezone
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
        message:
          "Valid pickup and return timestamps with timezones are required",
      });
    }

    // 3. Check availability using our reusable service
    const result = await checkVehicleAvailability({
      vehicleId: id,
      pickupAt,
      returnAt,
    });

    // 4. Do not expose inactive vehicles publicly
    if (
      result.reason === "vehicle_not_found" ||
      result.reason === "vehicle_inactive"
    ) {
      return res.status(StatusCodes.NOT_FOUND).json({
        success: false,
        message: "Vehicle not found",
      });
    }

    // 5. Return availability information
    return res.status(StatusCodes.OK).json({
      success: true,

      vehicleId: id,

      rentalPeriod: {
        pickupAt: new Date(pickupAt).toISOString(),
        returnAt: new Date(returnAt).toISOString(),
      },

      availability: {
        available: result.available,

        reason: result.available
          ? null
          : "unavailable_for_selected_dates",
      },

      message: result.available
        ? "Vehicle is currently available for the selected period"
        : "Vehicle is unavailable for the selected period",

      reservationConfirmed: false,
    });
  } catch (error) {
    // Invalid dates should return a client error
    if (
      error instanceof TypeError ||
      error instanceof RangeError
    ) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: error.message,
      });
    }

    console.error("Vehicle availability error:", error);

    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Unable to check vehicle availability",
    });
  }
};
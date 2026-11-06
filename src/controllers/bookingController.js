import { StatusCodes } from "http-status-codes";

import Booking from "../models/Booking.js";
import { checkVehicleAvailability } from "../services/availabilityService.js";
import Vehicle from "../models/Vehicle.js";
import BusinessSettings from "../models/BusinessSettings.js";
import { calculateBestRentalRate } from "../services/pricingService.js";

export const getRentalQuote = async (req, res) => {
  try {
    const { vehicleId, pickupAt, returnAt } = req.body ?? {};

    // 1. Validate the vehicle ID
    if (typeof vehicleId !== "string" || !/^[a-fA-F0-9]{24}$/.test(vehicleId)) {
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

export const createBookingRequest = async (req, res) => {
  try {
    const { vehicleId, pickupAt, returnAt, pickupLocation, returnLocation } =
      req.body ?? {};

    // 1. Validate vehicle ID
    if (typeof vehicleId !== "string" || !/^[a-fA-F0-9]{24}$/.test(vehicleId)) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: "A valid vehicle ID is required",
      });
    }

    // 2. Validate pickup and return arrangements
    // Only office arrangements are enabled for now.
    if (
      pickupLocation?.type !== "office" ||
      returnLocation?.type !== "office"
    ) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: "Only office pickup and return are currently supported",
      });
    }

    // Reject unsupported addresses rather than ignoring them
    if (pickupLocation.address || returnLocation.address) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: "Addresses are not required for office pickup or return",
      });
    }

    // 3. Validate timezone-aware rental timestamps
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

    // 4. Check current vehicle availability
    const availability = await checkVehicleAvailability({
      vehicleId,
      pickupAt: pickupDate,
      returnAt: returnDate,
    });

    if (!availability.available) {
      const notFound = ["vehicle_not_found", "vehicle_inactive"].includes(
        availability.reason,
      );

      return res
        .status(notFound ? StatusCodes.NOT_FOUND : StatusCodes.CONFLICT)
        .json({
          success: false,
          message: notFound
            ? "Vehicle not found"
            : "Vehicle is unavailable for the selected dates",
        });
    }

    // 5. Retrieve rental prices from MongoDB
    const vehicle = await Vehicle.findOne({
      _id: vehicleId,
      isActive: true,
      operationalStatus: "available",
    })
      .select("brand model year pricing")
      .lean();

    if (!vehicle) {
      return res.status(StatusCodes.CONFLICT).json({
        success: false,
        message: "Vehicle is no longer available",
      });
    }

    // 6. Load the current administrator pricing policy
    const settings = await BusinessSettings.findOne({
      key: "primary",
    });

    const policy =
      settings?.pricingPolicy ??
      new BusinessSettings({
        key: "primary",
      }).pricingPolicy;

    // 7. Calculate the rental price on the server
    let quote;

    try {
      quote = calculateBestRentalRate({
        pickupAt: pickupDate,
        returnAt: returnDate,
        rates: vehicle.pricing,
        policy,
      });
    } catch (error) {
      if (error.message?.startsWith("Rental duration must be between")) {
        return res.status(StatusCodes.BAD_REQUEST).json({
          success: false,
          message: error.message,
        });
      }

      throw error;
    }

    // 8. Create the booking request
    // No checkout lock is created here.
    const booking = await Booking.create({
      customer: req.user._id,

      vehicle: vehicle._id,

      rentalPeriod: {
        pickupAt: pickupDate,
        returnAt: returnDate,
      },

      pickupLocation: {
        type: "office",
      },

      returnLocation: {
        type: "office",
      },

      pricing: {
        currency: "NGN",
        rentalDays: quote.rentalDays,
        ratePlan: quote.ratePlan,
        ratesSnapshot: quote.ratesSnapshot,
        rateBreakdown: quote.rateBreakdown,
        rentalAmount: quote.rentalAmount,

        // Office pickup and return only for now
        pickupFee: 0,
        returnFee: 0,
        totalAmount: quote.rentalAmount,
      },

      status: "requested",
      verificationStatus: "not_submitted",
      paymentStatus: "unpaid",
    });

    // 9. Return the newly created booking
    return res.status(StatusCodes.CREATED).json({
      success: true,
      message: "Booking request submitted successfully",

      booking: {
        id: booking._id,
        customer: booking.customer,

        vehicle: {
          id: vehicle._id,
          brand: vehicle.brand,
          model: vehicle.model,
          year: vehicle.year,
        },

        rentalPeriod: booking.rentalPeriod,
        pickupLocation: booking.pickupLocation,
        returnLocation: booking.returnLocation,
        pricing: booking.pricing,

        status: booking.status,
        verificationStatus: booking.verificationStatus,
        paymentStatus: booking.paymentStatus,
        createdAt: booking.createdAt,
      },

      reservationConfirmed: false,
    });
  } catch (error) {
    if (error.name === "ValidationError") {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: "Booking data failed validation",
      });
    }

    console.error("Create booking error:", error);

    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Unable to submit booking request",
    });
  }
};

export const getMyBookings = async (req, res) => {
  try {
    // 1. Read pagination parameters
    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 10);

    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 50 ||
      !Number.isSafeInteger((page - 1) * limit)
    ) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: "Invalid pagination parameters",
      });
    }

    const skip = (page - 1) * limit;

    // 2. Restrict results to the authenticated customer
    const filter = {
      customer: req.user._id,
    };

    // 3. Retrieve bookings and total count
    const [bookings, total] = await Promise.all([
      Booking.find(filter)

        .select(
          "vehicle rentalPeriod pickupLocation returnLocation pricing status verificationStatus paymentStatus rejectionReason createdAt updatedAt",
        )

        .populate({
          path: "vehicle",
          select: "brand model year category images",
        })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),

      Booking.countDocuments(filter),
    ]);

    // 4. Return paginated booking history
    return res.status(StatusCodes.OK).json({
      success: true,
      message: "Bookings retrieved successfully",
      bookings,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNextPage: skip + bookings.length < total,
      },
    });
  } catch (error) {
    console.error("Get my bookings error:", error);

    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Unable to retrieve bookings",
    });
  }
};

export const getMyBookingById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!/^[a-fA-F0-9]{24}$/.test(id)) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: "Invalid booking ID",
      });
    }

    const booking = await Booking.findOne({
      _id: id,
      customer: req.user._id,
    })

      .select(
        "vehicle rentalPeriod pickupLocation returnLocation pricing status verificationStatus paymentStatus rejectionReason createdAt updatedAt",
      )

      .populate({
        path: "vehicle",
        select: "brand model year category images",
      })
      .lean();

    if (!booking) {
      return res.status(StatusCodes.NOT_FOUND).json({
        success: false,
        message: "Booking not found",
      });
    }

    return res.status(StatusCodes.OK).json({
      success: true,
      message: "Booking retrieved successfully",
      booking,
    });
  } catch (error) {
    console.error("Get my booking error:", error);

    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Unable to retrieve booking",
    });
  }
};

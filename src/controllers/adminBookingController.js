import { StatusCodes } from "http-status-codes";

import Booking from "../models/Booking.js";
import {
  checkVehicleAvailability,
} from "../services/availabilityService.js";

const isValidId = (id) =>
  typeof id === "string" &&
  /^[a-fA-F0-9]{24}$/.test(id);

// GET /api/admin/bookings
export const getAdminBookings = async (req, res) => {
  try {
    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 10);
    const { status } = req.query;

    const skip = (page - 1) * limit;

    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 50 ||
      !Number.isSafeInteger(skip)
    ) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: "Invalid pagination parameters",
      });
    }

    const filter = {};

    // Optional filtering by booking status
    if (status !== undefined) {
      const allowedStatuses =
        Booking.schema.path("status").enumValues;

      if (
        typeof status !== "string" ||
        !allowedStatuses.includes(status)
      ) {
        return res.status(StatusCodes.BAD_REQUEST).json({
          success: false,
          message: "Invalid booking status",
        });
      }

      filter.status = status;
    }

    const [bookings, total] = await Promise.all([
      Booking.find(filter)
        .select(
          "customer vehicle rentalPeriod pricing status verificationStatus paymentStatus reviewedBy reviewedAt rejectionReason createdAt"
        )
        .populate({
          path: "customer",
          select: "firstName lastName email phone",
        })
        .populate({
          path: "vehicle",
          select: "brand model year category",
        })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),

      Booking.countDocuments(filter),
    ]);

    return res.status(StatusCodes.OK).json({
      success: true,
      message: "Admin bookings retrieved successfully",
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
    console.error("Get admin bookings error:", error);

    return res.status(
      StatusCodes.INTERNAL_SERVER_ERROR
    ).json({
      success: false,
      message: "Unable to retrieve bookings",
    });
  }
};

// Shared logic for approving or rejecting a booking
const reviewBooking = (decision) => async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidId(id)) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: "Invalid booking ID",
      });
    }

    // A rejection must include a customer-facing reason.
    let rejectionReason = "";

    if (decision === "reject") {
      const reason = req.body?.reason;

      if (
        typeof reason !== "string" ||
        !reason.trim() ||
        reason.trim().length > 500
      ) {
        return res.status(StatusCodes.BAD_REQUEST).json({
          success: false,
          message:
            "A rejection reason of 1 to 500 characters is required",
        });
      }

      rejectionReason = reason.trim();
    }

    // Find the booking before attempting review
    const booking = await Booking.findById(id)
      .select("customer vehicle rentalPeriod status")
      .lean();

    if (!booking) {
      return res.status(StatusCodes.NOT_FOUND).json({
        success: false,
        message: "Booking not found",
      });
    }

    // Administrators cannot review their own requests.
    if (
      String(booking.customer) ===
      String(req.user._id)
    ) {
      return res.status(StatusCodes.FORBIDDEN).json({
        success: false,
        message:
          "You cannot review your own booking request",
      });
    }

    // Only newly submitted requests may be reviewed.
    if (booking.status !== "requested") {
      return res.status(StatusCodes.CONFLICT).json({
        success: false,
        message: "This booking has already been reviewed",
      });
    }

    // An approval requires valid, future rental dates
    // and currently available vehicle dates.
    if (decision === "approve") {
      const { pickupAt, returnAt } =
        booking.rentalPeriod ?? {};

      if (
        !(pickupAt instanceof Date) ||
        !(returnAt instanceof Date) ||
        !Number.isFinite(pickupAt.getTime()) ||
        !Number.isFinite(returnAt.getTime()) ||
        pickupAt <= new Date() ||
        returnAt <= pickupAt
      ) {
        return res.status(StatusCodes.CONFLICT).json({
          success: false,
          message:
            "Booking dates are no longer valid for approval",
        });
      }

      const availability =
        await checkVehicleAvailability({
          vehicleId: String(booking.vehicle),
          pickupAt,
          returnAt,
        });

      if (!availability.available) {
        return res.status(StatusCodes.CONFLICT).json({
          success: false,
          message:
            "Vehicle is currently unavailable for these dates",
        });
      }
    }

    const nextStatus =
      decision === "approve"
        ? "provisionally_approved"
        : "rejected";

    // Atomically transition only a requested booking.
    const updatedBooking =
      await Booking.findOneAndUpdate(
        {
          _id: id,
          status: "requested",
        },
        {
          $set: {
            status: nextStatus,
            reviewedBy: req.user._id,
            reviewedAt: new Date(),
            rejectionReason,
          },
        },
        {
          returnDocument: "after",
          runValidators: true,
        }
      ).select(
        "customer vehicle rentalPeriod status verificationStatus paymentStatus reviewedBy reviewedAt rejectionReason"
      );

    if (!updatedBooking) {
      return res.status(StatusCodes.CONFLICT).json({
        success: false,
        message:
          "Booking status changed during review",
      });
    }

    return res.status(StatusCodes.OK).json({
      success: true,
      message:
        decision === "approve"
          ? "Booking provisionally approved"
          : "Booking request rejected",
      booking: updatedBooking,
      reservationConfirmed: false,
    });
  } catch (error) {
    console.error("Review booking error:", error);

    return res.status(
      StatusCodes.INTERNAL_SERVER_ERROR
    ).json({
      success: false,
      message: "Unable to review booking request",
    });
  }
};

export const approveBooking = reviewBooking("approve");

export const rejectBooking = reviewBooking("reject");
import { StatusCodes } from "http-status-codes";
import mongoose from "mongoose";

import CheckoutLock from "../models/CheckoutLock.js";
import Vehicle from "../models/Vehicle.js";
import Booking from "../models/Booking.js";
import AvailabilityBlock from "../models/AvailabilityBlock.js";

class AvailabilityRuleError extends Error {
  constructor(message, statusCode = 409) {
    super(message);
    this.name = "AvailabilityRuleError";
    this.statusCode = statusCode;
  }
}

export const createAvailabilityBlock = async (req, res) => {
  let session;

  try {
    const { id } = req.params;
    const {
      reason,
      startAt,
      endAt,
      notes = "",
    } = req.body ?? {};

    // 1. Validate vehicle ID
    if (!/^[a-fA-F0-9]{24}$/.test(id)) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: "Invalid vehicle ID",
      });
    }

    // 2. Validate reason
    const allowedReasons = [
      "maintenance",
      "inspection",
      "other",
    ];

    if (
      typeof reason !== "string" ||
      !allowedReasons.includes(reason)
    ) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: "Invalid availability block reason",
      });
    }

    // 3. Validate optional notes
    if (
      typeof notes !== "string" ||
      notes.trim().length > 500
    ) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: "Notes must not exceed 500 characters",
      });
    }

    // 4. Require timezone-aware timestamps
    const timestampPattern =
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

    if (
      typeof startAt !== "string" ||
      typeof endAt !== "string" ||
      !timestampPattern.test(startAt) ||
      !timestampPattern.test(endAt)
    ) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: "Valid timestamps with timezones are required",
      });
    }

    const startDate = new Date(startAt);
    const endDate = new Date(endAt);

    if (
      Number.isNaN(startDate.getTime()) ||
      Number.isNaN(endDate.getTime()) ||
      startDate <= new Date() ||
      endDate <= startDate
    ) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: "Choose a valid future availability period",
      });
    }

    // 5. Start a MongoDB session
    session = await mongoose.startSession();

    // 6. Run availability checks and block creation
    //    in one transaction.
    const block = await session.withTransaction(
      async () => {
        // A. Write to the shared Vehicle document FIRST.
        // All availability-changing transactions must
        // follow this coordination rule.
        const vehicle = await Vehicle.findOneAndUpdate(
          { _id: id },
          {
            $inc: {
              availabilityRevision: 1,
            },
          },
          {
            session,
            new: true,
          }
        ).select("_id");

        if (!vehicle) {
          throw new AvailabilityRuleError(
            "Vehicle not found",
            404
          );
        }

        // B. Check for confirmed or ongoing bookings
        const conflictingBooking = await Booking.exists({
          vehicle: id,
          status: {
            $in: ["confirmed", "in_progress"],
          },
          "rentalPeriod.pickupAt": { $lt: endDate },
          "rentalPeriod.returnAt": { $gt: startDate },
        }).session(session);

        if (conflictingBooking) {
          throw new AvailabilityRuleError(
            "This period conflicts with an existing reservation"
          );
        }

        // C. Check active checkout locks
        const conflictingCheckoutLock =
          await CheckoutLock.exists({
            vehicle: id,
            status: "active",
            expiresAt: { $gt: new Date() },
            "rentalPeriod.pickupAt": { $lt: endDate },
            "rentalPeriod.returnAt": { $gt: startDate },
          }).session(session);

        if (conflictingCheckoutLock) {
          throw new AvailabilityRuleError(
            "This vehicle has an active checkout for the selected period"
          );
        }

        // D. Check existing scheduled restrictions
        const conflictingBlock =
          await AvailabilityBlock.exists({
            vehicle: id,
            isActive: true,
            startAt: { $lt: endDate },
            endAt: { $gt: startDate },
          }).session(session);

        if (conflictingBlock) {
          throw new AvailabilityRuleError(
            "An availability block already exists for this period"
          );
        }

        // E. Create the block inside the transaction
        const [createdBlock] =
          await AvailabilityBlock.create(
            [
              {
                vehicle: vehicle._id,
                reason,
                startAt: startDate,
                endAt: endDate,
                notes: notes.trim(),
                createdBy: req.user._id,
              },
            ],
            { session }
          );

        return createdBlock;
      },
      {
        readPreference: "primary",
        readConcern: { level: "snapshot" },
        writeConcern: { w: "majority" },
      }
    );

    // 7. Respond only after a successful commit
    return res.status(StatusCodes.CREATED).json({
      success: true,
      message: "Availability block created successfully",
      block: {
        id: block._id,
        vehicle: block.vehicle,
        reason: block.reason,
        startAt: block.startAt,
        endAt: block.endAt,
        notes: block.notes,
        isActive: block.isActive,
        createdBy: block.createdBy,
      },
    });
  } catch (error) {
    // Expected availability conflicts
    if (error instanceof AvailabilityRuleError) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }

    // Mongoose validation errors
    if (error.name === "ValidationError") {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: "Invalid availability block information",
      });
    }

    console.error("Create availability block error:", error);

    return res.status(
      StatusCodes.INTERNAL_SERVER_ERROR
    ).json({
      success: false,
      message: "Unable to create availability block",
    });
  } finally {
    if (session) {
      await session.endSession();
    }
  }
};

export const getVehicleAvailabilityBlocks = async (req, res) => {
  try {
    const { id } = req.params;

    // 1. Validate vehicle ID
    if (!/^[a-fA-F0-9]{24}$/.test(id)) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: "Invalid vehicle ID",
      });
    }

    // 2. Confirm that the vehicle exists
    const vehicle = await Vehicle.findById(id)
      .select("brand model year")
      .lean();

    if (!vehicle) {
      return res.status(StatusCodes.NOT_FOUND).json({
        success: false,
        message: "Vehicle not found",
      });
    }

    // 3. Retrieve active and inactive blocks
    const blocks = await AvailabilityBlock.find({
      vehicle: id,
    })
      .select(
        "vehicle reason startAt endAt notes isActive createdBy deactivatedBy deactivatedAt createdAt"
      )
      .sort({ startAt: -1 })
      .lean();

    // 4. Return the results
    return res.status(StatusCodes.OK).json({
      success: true,
      message: "Availability blocks retrieved successfully",
      vehicle: {
        id: vehicle._id,
        brand: vehicle.brand,
        model: vehicle.model,
        year: vehicle.year,
      },
      count: blocks.length,
      blocks,
    });
  } catch (error) {
    console.error("Get availability blocks error:", error);

    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Unable to retrieve availability blocks",
    });
  }
};

export const deactivateAvailabilityBlock = async (req, res) => {
  try {
    const { blockId } = req.params;

    // 1. Validate block ID
    if (!/^[a-fA-F0-9]{24}$/.test(blockId)) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: "Invalid availability block ID",
      });
    }

    // 2. Deactivate the block if it is still active
    const block = await AvailabilityBlock.findOneAndUpdate(
      {
        _id: blockId,
        isActive: true,
      },
      {
        $set: {
          isActive: false,
          deactivatedBy: req.user._id,
          deactivatedAt: new Date(),
        },
      },
      {
        new: true,
        runValidators: true,
      }
    );

    // 3. Handle blocks that could not be updated
    if (!block) {
      const existingBlock =
        await AvailabilityBlock.findById(blockId);

      if (!existingBlock) {
        return res.status(StatusCodes.NOT_FOUND).json({
          success: false,
          message: "Availability block not found",
        });
      }

      return res.status(StatusCodes.OK).json({
        success: true,
        message: "Availability block is already deactivated",
        changed: false,
      });
    }

    // 4. Return the updated record
    return res.status(StatusCodes.OK).json({
      success: true,
      message: "Availability block deactivated successfully",
      changed: true,
      block: {
        id: block._id,
        vehicle: block.vehicle,
        reason: block.reason,
        startAt: block.startAt,
        endAt: block.endAt,
        isActive: block.isActive,
        deactivatedBy: block.deactivatedBy,
        deactivatedAt: block.deactivatedAt,
      },
    });
  } catch (error) {
    console.error("Deactivate availability block error:", error);

    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Unable to deactivate availability block",
    });
  }
};
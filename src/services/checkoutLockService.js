import mongoose from "mongoose";
import { randomUUID } from "node:crypto";

import Vehicle from "../models/Vehicle.js";
import Booking from "../models/Booking.js";
import AvailabilityBlock from "../models/AvailabilityBlock.js";
import CheckoutLock from "../models/CheckoutLock.js";

// Temporary configuration.
// We'll eventually read this from BusinessSettings.
const CHECKOUT_LOCK_MINUTES = 5;
const LOCK_DURATION_MS = CHECKOUT_LOCK_MINUTES * 60 * 1000;

const isValidId = (value) =>
  /^[a-fA-F0-9]{24}$/.test(String(value ?? ""));

// Business errors that a controller can handle.
export class CheckoutLockError extends Error {
  constructor(message, statusCode = 409) {
    super(message);
    this.name = "CheckoutLockError";
    this.statusCode = statusCode;
  }
}

export const acquireCheckoutLock = async ({
  bookingId,
  customerId,
}) => {
  // 1. Validate identifiers
  if (!isValidId(bookingId) || !isValidId(customerId)) {
    throw new CheckoutLockError(
      "Valid booking and customer IDs are required",
      400
    );
  }

  const session = await mongoose.startSession();

  try {
    // 2. Execute the entire operation in a transaction
    return await session.withTransaction(
      async () => {
        // 3. Retrieve the booking
        const booking = await Booking.findById(bookingId)
          .select(
            "customer vehicle rentalPeriod status verificationStatus paymentStatus"
          )
          .session(session)
          .lean();

        if (
          !booking ||
          String(booking.customer) !== String(customerId)
        ) {
          throw new CheckoutLockError(
            "Booking not found",
            404
          );
        }

        // 4. Check checkout eligibility
        if (booking.status !== "awaiting_payment") {
          throw new CheckoutLockError(
            "Booking is not ready for payment"
          );
        }

        if (booking.verificationStatus !== "approved") {
          throw new CheckoutLockError(
            "Customer verification is not approved"
          );
        }

        if (
          !["unpaid", "failed"].includes(booking.paymentStatus)
        ) {
          throw new CheckoutLockError(
            "Booking payment status does not allow checkout"
          );
        }

        const pickupAt = booking.rentalPeriod?.pickupAt;
        const returnAt = booking.rentalPeriod?.returnAt;

        if (
          !(pickupAt instanceof Date) ||
          !(returnAt instanceof Date) ||
          Number.isNaN(pickupAt.getTime()) ||
          Number.isNaN(returnAt.getTime()) ||
          returnAt <= pickupAt
        ) {
          throw new CheckoutLockError(
            "Booking has invalid rental dates",
            400
          );
        }

        // 5. Update a shared Vehicle document FIRST.
        // Concurrent checkout transactions for this vehicle
        // must contend on this document.
        const vehicle = await Vehicle.findOneAndUpdate(
          {
            _id: booking.vehicle,
            isActive: true,
            operationalStatus: "available",
          },
          {
            $inc: { availabilityRevision: 1 },
          },
          {
            session,
            new: true,
          }
        ).select("_id");

        if (!vehicle) {
          throw new CheckoutLockError(
            "Vehicle is not available for checkout"
          );
        }

        const now = new Date();

        if (pickupAt <= now) {
          throw new CheckoutLockError(
            "Rental pickup date must be in the future",
            400
          );
        }

        // 6. Shared overlap conditions
        const overlapFilter = {
          vehicle: booking.vehicle,
          "rentalPeriod.pickupAt": { $lt: returnAt },
          "rentalPeriod.returnAt": { $gt: pickupAt },
        };

        // 7. Reject conflicting confirmed reservations
        const conflictingBooking = await Booking.exists({
          ...overlapFilter,
          status: {
            $in: ["confirmed", "in_progress"],
          },
        }).session(session);

        if (conflictingBooking) {
          throw new CheckoutLockError(
            "Vehicle is already reserved for these dates"
          );
        }

        // 8. Reject overlapping maintenance restrictions
        const conflictingBlock = await AvailabilityBlock.exists({
          vehicle: booking.vehicle,
          isActive: true,
          startAt: { $lt: returnAt },
          endAt: { $gt: pickupAt },
        }).session(session);

        if (conflictingBlock) {
          throw new CheckoutLockError(
            "Vehicle is unavailable during these dates"
          );
        }

        // 9. Reject another booking's active checkout lock
        const conflictingLock = await CheckoutLock.exists({
          ...overlapFilter,
          booking: { $ne: booking._id },
          status: "active",
          expiresAt: { $gt: now },
        }).session(session);

        if (conflictingLock) {
          throw new CheckoutLockError(
            "Another customer is currently checking out this vehicle"
          );
        }

        // 10. Check whether this booking has a lock already
        let lock = await CheckoutLock.findOne({
          booking: booking._id,
        }).session(session);

        // Return the existing lock for an active checkout.
        // This makes repeated checkout requests idempotent.
        if (
          lock &&
          lock.status === "active" &&
          lock.expiresAt > now
        ) {
          return {
            lockId: lock._id,
            lockToken: lock.lockToken,
            expiresAt: lock.expiresAt,
            reused: true,
          };
        }

        // 11. Generate a fresh checkout attempt
        const expiresAt = new Date(
          now.getTime() + LOCK_DURATION_MS
        );

        const lockToken = randomUUID();

        if (lock) {
          // Reuse the existing document after expiration
          // or explicit release.
          lock.vehicle = booking.vehicle;
          lock.customer = booking.customer;
          lock.rentalPeriod = {
            pickupAt,
            returnAt,
          };
          lock.lockToken = lockToken;
          lock.expiresAt = expiresAt;
          lock.status = "active";
          lock.releasedAt = null;

          await lock.save({ session });
        } else {
          // First checkout attempt for this booking
          const [newLock] = await CheckoutLock.create(
            [
              {
                vehicle: booking.vehicle,
                booking: booking._id,
                customer: booking.customer,
                rentalPeriod: {
                  pickupAt,
                  returnAt,
                },
                lockToken,
                expiresAt,
                status: "active",
              },
            ],
            { session }
          );

          lock = newLock;
        }

        // 12. Return the result after successful commit
        return {
          lockId: lock._id,
          lockToken,
          expiresAt,
          reused: false,
        };
      },
      {
        readPreference: "primary",
        readConcern: { level: "snapshot" },
        writeConcern: { w: "majority" },
      }
    );
  } finally {
    await session.endSession();
  }
};

export const releaseCheckoutLock = async ({
  bookingId,
  customerId,
  lockToken,
}) => {
  // 1. Validate the supplied identifiers
  if (
    !isValidId(bookingId) ||
    !isValidId(customerId) ||
    typeof lockToken !== "string" ||
    !lockToken.trim()
  ) {
    throw new CheckoutLockError(
      "Valid checkout lock details are required",
      400
    );
  }

  // 2. Release only the matching active lock
  const lock = await CheckoutLock.findOneAndUpdate(
    {
      booking: bookingId,
      customer: customerId,
      lockToken,
      status: "active",
    },
    {
      $set: {
        status: "released",
        releasedAt: new Date(),
      },
    },
    {
      new: true,
      runValidators: true,
    }
  );

  if (lock) {
    return {
      released: true,
      lockId: lock._id,
      releasedAt: lock.releasedAt,
    };
  }

  // 3. Check whether this specific lock was already released
  const existingLock = await CheckoutLock.findOne({
    booking: bookingId,
    customer: customerId,
  }).select("lockToken status");

  if (
    !existingLock ||
    existingLock.lockToken !== lockToken
  ) {
    throw new CheckoutLockError(
      "Checkout lock not found or no longer valid",
      404
    );
  }

  if (existingLock.status === "released") {
    return {
      released: false,
      reason: "already_released",
    };
  }

  throw new CheckoutLockError(
    "Checkout lock cannot be released in its current state",
    409
  );
};
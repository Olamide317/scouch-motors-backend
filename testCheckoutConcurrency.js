import "dotenv/config";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import connectDB from "./src/config/db.js";

import Vehicle from "./src/models/Vehicle.js";
import User from "./src/models/User.js";
import Booking from "./src/models/Booking.js";
import CheckoutLock from "./src/models/CheckoutLock.js";

import {
  acquireCheckoutLock,
  releaseCheckoutLock,
  CheckoutLockError,
} from "./src/services/checkoutLockService.js";

import { checkVehicleAvailability } from "./src/services/availabilityService.js";

const [vehicleId, customerId] = process.argv.slice(2);

const DAY = 24 * 60 * 60 * 1000;
const createdBookingIds = [];

async function runTest() {
  try {
    // Never run this test on a production database
    if (process.env.NODE_ENV === "production") {
      throw new Error("This test cannot run in production");
    }

    if (!vehicleId || !customerId) {
      throw new Error(
        "Usage: node testCheckoutConcurrency.js VEHICLE_ID CUSTOMER_ID",
      );
    }

    // 1. Connect to MongoDB
    await connectDB();

    // Ensure CheckoutLock indexes are initialized
    await CheckoutLock.init();

    // 2. Verify the test vehicle and customer
    const vehicle = await Vehicle.findOne({
      _id: vehicleId,
      isActive: true,
      operationalStatus: "available",
    });

    const customer = await User.findOne({
      _id: customerId,
      isActive: true,
    });

    assert.ok(vehicle, "Active test vehicle not found");
    assert.ok(customer, "Active test customer not found");

    // 3. Create a future three-day rental period
    const pickupAt = new Date(Date.now() + 21 * DAY);
    const returnAt = new Date(pickupAt.getTime() + 3 * DAY);

    // Avoid interfering with existing restrictions
    const availability = await checkVehicleAvailability({
      vehicleId,
      pickupAt,
      returnAt,
    });

    assert.equal(
      availability.available,
      true,
      "Test vehicle is unavailable for the chosen dates",
    );

    const existingLock = await CheckoutLock.exists({
      vehicle: vehicleId,
      status: "active",
      expiresAt: { $gt: new Date() },
      "rentalPeriod.pickupAt": { $lt: returnAt },
      "rentalPeriod.returnAt": { $gt: pickupAt },
    });

    assert.equal(
      existingLock,
      null,
      "An existing checkout lock overlaps the test period",
    );

    // 4. Build isolated test booking data
    const dailyRate = vehicle.pricing.daily;

    const createTestBooking = async () => {
      const booking = await Booking.create({
        customer: customer._id,
        vehicle: vehicle._id,

        rentalPeriod: {
          pickupAt,
          returnAt,
        },

        pickupLocation: {
          type: "office",
        },

        returnLocation: {
          type: "office",
        },

        pricing: {
          currency: "NGN",
          rentalDays: 3,
          ratePlan: "daily",

          ratesSnapshot: {
            daily: vehicle.pricing.daily,
            weekly: vehicle.pricing.weekly,
            monthly: vehicle.pricing.monthly,
          },

          rentalAmount: dailyRate * 3,
          pickupFee: 0,
          returnFee: 0,
          totalAmount: dailyRate * 3,
        },

        status: "awaiting_payment",
        verificationStatus: "approved",
        paymentStatus: "unpaid",
      });

      createdBookingIds.push(booking._id);

      return booking;
    };

    // Both bookings use the same vehicle and dates
    const bookingA = await createTestBooking();
    const bookingB = await createTestBooking();

    console.log("Temporary test bookings created");

    // 5. Attempt both checkouts concurrently
    const results = await Promise.allSettled([
      acquireCheckoutLock({
        bookingId: String(bookingA._id),
        customerId: String(customer._id),
      }),

      acquireCheckoutLock({
        bookingId: String(bookingB._id),
        customerId: String(customer._id),
      }),
    ]);

    const winnerIndex = results.findIndex(
      (result) => result.status === "fulfilled",
    );

    const successCount = results.filter(
      (result) => result.status === "fulfilled",
    ).length;

    assert.equal(successCount, 1, "Exactly one checkout attempt must succeed");

    const loserIndex = 1 - winnerIndex;
    const rejection = results[loserIndex].reason;

    assert.ok(
      rejection instanceof CheckoutLockError && rejection.statusCode === 409,
      "The competing checkout should be rejected with a conflict",
    );

    console.log("PASS: Exactly one checkout acquired a lock");
    console.log("PASS: Overlapping checkout was rejected");

    // An active checkout lock should affect availability
    const availabilityDuringCheckout = await checkVehicleAvailability({
      vehicleId,
      pickupAt,
      returnAt,
    });

    assert.equal(availabilityDuringCheckout.available, false);

    assert.equal(availabilityDuringCheckout.reason, "checkout_in_progress");

    console.log("PASS: Active checkout lock blocks conflicting availability");

    // 6. Verify only one unexpired lock exists
    const activeLockCount = await CheckoutLock.countDocuments({
      booking: { $in: createdBookingIds },
      status: "active",
      expiresAt: { $gt: new Date() },
    });

    assert.equal(activeLockCount, 1);

    const bookings = [bookingA, bookingB];
    const winningBooking = bookings[winnerIndex];
    const losingBooking = bookings[loserIndex];

    // 7. Repeating checkout should reuse the lock
    const repeated = await acquireCheckoutLock({
      bookingId: String(winningBooking._id),
      customerId: String(customer._id),
    });

    assert.equal(repeated.reused, true);

    console.log("PASS: Repeated checkout reused its lock");

    // 8. Simulate expiration of the winning lock
    await CheckoutLock.updateOne(
      { _id: repeated.lockId },
      {
        $set: {
          expiresAt: new Date(Date.now() - 1000),
        },
      },
    );

    // Expired locks should no longer affect availability
    const availabilityAfterExpiry = await checkVehicleAvailability({
      vehicleId,
      pickupAt,
      returnAt,
    });

    assert.equal(availabilityAfterExpiry.available, true);

    console.log("PASS: Expired checkout lock no longer blocks availability");

    // 9. The losing booking should now be able
    // to acquire its own lock
    const nextLock = await acquireCheckoutLock({
      bookingId: String(losingBooking._id),
      customerId: String(customer._id),
    });

    assert.equal(nextLock.reused, false);

    const remainingActiveLocks = await CheckoutLock.countDocuments({
      booking: { $in: createdBookingIds },
      status: "active",
      expiresAt: { $gt: new Date() },
    });

    assert.equal(remainingActiveLocks, 1);

    console.log("PASS: Expired lock no longer blocks checkout");

    // Explicitly release the second customer's checkout lock
    const releaseResult = await releaseCheckoutLock({
      bookingId: String(losingBooking._id),
      customerId: String(customer._id),
      lockToken: nextLock.lockToken,
    });

    assert.equal(releaseResult.released, true);

    // Availability should return to normal
    const availabilityAfterRelease = await checkVehicleAvailability({
      vehicleId,
      pickupAt,
      returnAt,
    });

    assert.equal(availabilityAfterRelease.available, true);

    console.log("PASS: Explicit release restores availability");

    // Repeating release should not produce another change
    const repeatedRelease = await releaseCheckoutLock({
      bookingId: String(losingBooking._id),
      customerId: String(customer._id),
      lockToken: nextLock.lockToken,
    });

    assert.equal(repeatedRelease.released, false);

    console.log("PASS: Repeated release is handled safely");

    console.log("PASS: All checkout-lock tests succeeded");
  } catch (error) {
    console.error("TEST FAILED:", error.message);
    process.exitCode = 1;
  } finally {
    // 10. Remove only the records created by this script
    try {
      if (
        createdBookingIds.length > 0 &&
        mongoose.connection.readyState === 1
      ) {
        await CheckoutLock.deleteMany({
          booking: { $in: createdBookingIds },
        });

        await Booking.deleteMany({
          _id: { $in: createdBookingIds },
        });

        console.log("Temporary test records removed");
      }
    } catch (error) {
      console.error("Cleanup failed:", error.message);
      process.exitCode = 1;
    }

    await mongoose.disconnect();
  }
}

runTest();

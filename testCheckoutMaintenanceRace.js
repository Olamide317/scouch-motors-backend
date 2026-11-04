
import "dotenv/config";
import assert from "node:assert/strict";
import mongoose from "mongoose";

import connectDB from "./src/config/db.js";

import Vehicle from "./src/models/Vehicle.js";
import User from "./src/models/User.js";
import Booking from "./src/models/Booking.js";
import CheckoutLock from "./src/models/CheckoutLock.js";
import AvailabilityBlock from "./src/models/AvailabilityBlock.js";

import {
  acquireCheckoutLock,
  releaseCheckoutLock,
  CheckoutLockError,
} from "./src/services/checkoutLockService.js";

import {
  checkVehicleAvailability,
} from "./src/services/availabilityService.js";

import {
  createAvailabilityBlock,
} from "./src/controllers/adminAvailabilityController.js";

const [vehicleId, adminId, customerId] =
  process.argv.slice(2);

const DAY = 24 * 60 * 60 * 1000;

const createdBookings = [];
const createdBlocks = [];

const rentalPeriod = (daysFromNow) => {
  const pickupAt = new Date(
    Date.now() + daysFromNow * DAY
  );

  return {
    pickupAt,
    returnAt: new Date(pickupAt.getTime() + 2 * DAY),
  };
};

async function main() {
  try {
    // This test modifies database records.
    if (process.env.NODE_ENV === "production") {
      throw new Error("Do not run against production");
    }

    if (!vehicleId || !adminId || !customerId) {
      throw new Error(
        "Provide VEHICLE_ID ADMIN_ID CUSTOMER_ID"
      );
    }

    await connectDB();

    await CheckoutLock.init();

    const vehicle = await Vehicle.findOne({
      _id: vehicleId,
      isActive: true,
      operationalStatus: "available",
    });

    const admin = await User.findOne({
      _id: adminId,
      role: "admin",
      isActive: true,
    });

    const customer = await User.findOne({
      _id: customerId,
      role: "customer",
      isActive: true,
    });

    assert.ok(vehicle, "Test vehicle not found");
    assert.ok(admin, "Active admin not found");
    assert.ok(customer, "Active customer not found");

    const createTestBooking = async (period) => {
      const daily = vehicle.pricing.daily;

      const booking = await Booking.create({
        customer: customer._id,
        vehicle: vehicle._id,

        rentalPeriod: period,

        pickupLocation: {
          type: "office",
        },

        returnLocation: {
          type: "office",
        },

        pricing: {
          currency: "NGN",
          rentalDays: 2,
          ratePlan: "daily",

          ratesSnapshot: {
            daily: vehicle.pricing.daily,
            weekly: vehicle.pricing.weekly,
            monthly: vehicle.pricing.monthly,
          },

          rentalAmount: daily * 2,
          pickupFee: 0,
          returnFee: 0,
          totalAmount: daily * 2,
        },

        status: "awaiting_payment",
        verificationStatus: "approved",
        paymentStatus: "unpaid",
      });

      createdBookings.push(booking._id);

      return booking;
    };

    // Invoke the actual admin controller with
    // a minimal mock Express request/response.
    const createTestBlock = async (period) => {
      const req = {
        params: {
          id: String(vehicle._id),
        },

        user: {
          _id: admin._id,
        },

        body: {
          reason: "inspection",
          startAt: period.pickupAt.toISOString(),
          endAt: period.returnAt.toISOString(),
          notes: "Temporary concurrency test",
        },
      };

      const res = {
        statusCode: 200,
        body: null,

        status(code) {
          this.statusCode = code;
          return this;
        },

        json(data) {
          this.body = data;
          return this;
        },
      };

      await createAvailabilityBlock(req, res);

      if (
        res.statusCode === 201 &&
        res.body?.block?.id
      ) {
        createdBlocks.push(res.body.block.id);
      }

      return res;
    };

    const checkInitiallyAvailable = async (period) => {
      const result = await checkVehicleAvailability({
        vehicleId: String(vehicle._id),
        ...period,
      });

      assert.equal(
        result.available,
        true,
        "Test dates are already unavailable"
      );
    };

    // ---------------------------------
    // TEST A: Checkout lock first
    // ---------------------------------

    const periodA = rentalPeriod(50);

    await checkInitiallyAvailable(periodA);

    const bookingA = await createTestBooking(periodA);

    const lockA = await acquireCheckoutLock({
      bookingId: String(bookingA._id),
      customerId: String(customer._id),
    });

    const blockedAdmin = await createTestBlock(periodA);

    assert.equal(blockedAdmin.statusCode, 409);

    console.log(
      "PASS A: Active checkout lock prevents maintenance"
    );

    await releaseCheckoutLock({
      bookingId: String(bookingA._id),
      customerId: String(customer._id),
      lockToken: lockA.lockToken,
    });

    // ---------------------------------
    // TEST B: Maintenance block first
    // ---------------------------------

    const periodB = rentalPeriod(60);

    await checkInitiallyAvailable(periodB);

    const bookingB = await createTestBooking(periodB);

    const blockB = await createTestBlock(periodB);

    assert.equal(blockB.statusCode, 201);

    await assert.rejects(
      () =>
        acquireCheckoutLock({
          bookingId: String(bookingB._id),
          customerId: String(customer._id),
        }),
      (error) =>
        error instanceof CheckoutLockError &&
        error.statusCode === 409
    );

    console.log(
      "PASS B: Active maintenance block prevents checkout"
    );

    // ---------------------------------
    // TEST C: Both start concurrently
    // ---------------------------------

    const periodC = rentalPeriod(70);

    await checkInitiallyAvailable(periodC);

    const bookingC = await createTestBooking(periodC);

    const [checkoutResult, adminResult] =
      await Promise.allSettled([
        acquireCheckoutLock({
          bookingId: String(bookingC._id),
          customerId: String(customer._id),
        }),

        createTestBlock(periodC),
      ]);

    const checkoutWon =
      checkoutResult.status === "fulfilled";

    const adminWon =
      adminResult.status === "fulfilled" &&
      adminResult.value.statusCode === 201;

    assert.equal(
      Number(checkoutWon) + Number(adminWon),
      1,
      "Exactly one conflicting operation must succeed"
    );

    if (checkoutWon) {
      assert.equal(adminResult.status, "fulfilled");
      assert.equal(adminResult.value.statusCode, 409);
    } else {
      assert.equal(checkoutResult.status, "rejected");

      assert.ok(
        checkoutResult.reason instanceof CheckoutLockError &&
        checkoutResult.reason.statusCode === 409,
        "Checkout should fail with a conflict"
      );
    }

    // Verify committed records, not just returned results.
    const [lockCount, blockCount] = await Promise.all([
      CheckoutLock.countDocuments({
        booking: bookingC._id,
        status: "active",
        expiresAt: { $gt: new Date() },
      }),

      AvailabilityBlock.countDocuments({
        vehicle: vehicle._id,
        isActive: true,
        startAt: { $lt: periodC.returnAt },
        endAt: { $gt: periodC.pickupAt },
      }),
    ]);

    assert.equal(
      lockCount + blockCount,
      1,
      "Database must contain exactly one conflicting restriction"
    );

    console.log(
      "PASS C: Concurrent operations cannot both succeed"
    );

    console.log(
      "All checkout/maintenance integration tests passed"
    );
  } catch (error) {
    console.error("TEST FAILED:", error.message);
    process.exitCode = 1;
  } finally {
    // Clean up only records created during this test.
    try {
      if (mongoose.connection.readyState === 1) {
        await CheckoutLock.deleteMany({
          booking: { $in: createdBookings },
        });

        await AvailabilityBlock.deleteMany({
          _id: { $in: createdBlocks },
        });

        await Booking.deleteMany({
          _id: { $in: createdBookings },
        });

        console.log("Temporary test records cleaned up");
      }
    } catch (error) {
      console.error("Cleanup failed:", error.message);
      process.exitCode = 1;
    }

    await mongoose.disconnect();
  }
}

main();

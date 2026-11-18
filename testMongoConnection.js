import "dotenv/config";
import mongoose from "mongoose";

try {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is not configured");
  }

  await mongoose.connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 10000,
  });

  console.log("MongoDB connection successful");

  // This is a read-only server information command.
  const info = await mongoose.connection.db
    .admin()
    .command({ hello: 1 });

  const deployment = info.setName
    ? "Replica set"
    : info.msg === "isdbgrid"
      ? "Sharded cluster"
      : "Standalone or unknown";

  console.log("Deployment type:", deployment);

  console.log(
    "Transaction support:",
    info.setName || info.msg === "isdbgrid"
      ? "Supported by deployment type"
      : "Not confirmed"
  );
} catch (error) {
  console.error("Connection check failed:", error.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
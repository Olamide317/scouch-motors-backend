import cloudinary from "../config/cloudinary.js";

async function testCloudinaryConnection() {
  try {
    console.log("Testing Cloudinary connection...");

    const result = await cloudinary.api.ping();

    if (result.status !== "ok") {
      throw new Error("Unexpected Cloudinary response");
    }

    console.log("Cloudinary connection successful!");
    console.log("Cloudinary API is responding correctly.");
  } catch (error) {
    console.error(
      "Cloudinary connection failed:",
      error.message
    );

    process.exitCode = 1;
  }
}

testCloudinaryConnection();
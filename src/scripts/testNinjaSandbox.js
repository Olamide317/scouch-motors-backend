import "dotenv/config";

import {
  verifyNinjaSandboxIdentity,
} from "../modules/verification/providers/ninjaSandboxClient.js";

const scenarios = {
  match: {
    idNumber: "77777777777",
    firstName: "James",
    lastName: "Bond",
    dateOfBirth: "1975-01-01",
  },

  mismatch: {
    idNumber: "77777777777",
    firstName: "John",
    lastName: "Doe",
    dateOfBirth: "1975-01-01",
  },

  not_found: {
    idNumber: "55555555555",
    firstName: "James",
    lastName: "Bond",
    dateOfBirth: "1975-01-01",
  },

  technical_failure: {
    idNumber: "00000000000",
    firstName: "James",
    lastName: "Bond",
    dateOfBirth: "1975-01-01",
  },
};

async function runTest() {
  const scenario = process.argv[2] ?? "match";

  if (!Object.hasOwn(scenarios, scenario)) {
    throw new Error(`Unknown test scenario: ${scenario}`);
  }

  console.log(`Running Ninja scenario: ${scenario}`);

  try {
    const result = await verifyNinjaSandboxIdentity(
      scenarios[scenario]
    );

    console.log("Verification result:", result);
  } catch (error) {
    if (error.httpStatus === 503) {
      console.log(
        "Provider technical failure simulated successfully."
      );
      console.log(
        "No incorrect-submission attempt should be consumed."
      );
      return;
    }

    throw error;
  }
}

runTest().catch((error) => {
  console.error("Test failed:", error.message);
  process.exitCode = 1;
});
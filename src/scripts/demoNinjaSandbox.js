import "dotenv/config";

import {
  createNinjaDemoLink,
  getNinjaDemoResult,
} from "../modules/verification/providers/ninjaSandboxClient.js";

const [command, verificationId] = process.argv.slice(2);

try {
  if (command === "start") {
    const result = await createNinjaDemoLink();

    console.log("Ninja sandbox demo link created:");
    console.log(`Verification ID: ${result.verificationId}`);
    console.log(`Hosted URL (keep private): ${result.url}`);

  } else if (command === "check") {
    const result = await getNinjaDemoResult(verificationId);

    console.log("Sandbox result:", result);
    console.log(
      "Sandbox verification does not grant booking eligibility."
    );

  } else {
    console.log(
      "Usage: node src/scripts/demoNinjaSandbox.js start"
    );
    console.log(
      "   or: node src/scripts/demoNinjaSandbox.js check vs_..."
    );
  }

} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
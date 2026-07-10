#!/usr/bin/env tsx
/**
 * CLI script to create beta invitations
 * Usage: npm run beta:invite email@example.com
 */

import "dotenv/config";
import { createBetaInvitation } from "../app/src/lib/betaInvitation";

async function main() {
  const email = process.argv[2];

  if (!email) {
    console.error("Usage: npm run beta:invite <email>");
    console.error("Example: npm run beta:invite dragon@example.com");
    process.exit(1);
  }

  if (!email.includes("@")) {
    console.error("Error: Invalid email address");
    process.exit(1);
  }

  try {
    const result = await createBetaInvitation(email);

    console.log("\n✓ Beta invitation created!\n");
    console.log("Email:      ", result.invitation.email);
    console.log("Code:       ", result.inviteCode);
    console.log("URL:        ", result.inviteUrl);
    console.log("Expires:    ", result.invitation.expiresAt.toLocaleDateString());
    console.log("");
  } catch (error) {
    if (error instanceof Error) {
      console.error("Error:", error.message);
    } else {
      console.error("Error creating invitation");
    }
    process.exit(1);
  }
}

main();

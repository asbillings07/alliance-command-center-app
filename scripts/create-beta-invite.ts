#!/usr/bin/env tsx
/**
 * CLI script to manage beta invitations
 * 
 * Usage:
 *   npm run beta:invite <email>         Create a new invitation
 *   npm run beta:invite lookup <email>  Look up an existing invitation
 *   npm run beta:invite list            List all invitations
 */

import "dotenv/config";
import { issueBetaInvitation } from "../app/src/lib/betaInvitation";
import { getRedeemUrl } from "../app/src/lib/appUrl";
import { prisma } from "../app/src/lib/prisma";

function printInvitation(invitation: {
  email: string;
  code: string;
  token: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  allianceId: string | null;
}) {
  const status = invitation.acceptedAt
    ? invitation.allianceId
      ? "Accepted (alliance created)"
      : "Accepted (no alliance yet)"
    : invitation.expiresAt < new Date()
      ? "Expired"
      : "Pending";

  console.log("Email:      ", invitation.email);
  console.log("Code:       ", invitation.code);
  console.log("URL:        ", getRedeemUrl(invitation.token));
  console.log("Expires:    ", invitation.expiresAt.toLocaleDateString());
  console.log("Status:     ", status);
}

async function lookupInvitation(email: string) {
  const invitation = await prisma.betaInvitation.findFirst({
    where: { email: email.toLowerCase().trim() },
    orderBy: { issuedAt: "desc" },
  });

  if (!invitation) {
    console.error(`No beta invitation found for: ${email}`);
    process.exit(1);
  }

  console.log("\n✓ Beta invitation found!\n");
  printInvitation(invitation);
  console.log("");
}

async function listInvitations() {
  const invitations = await prisma.betaInvitation.findMany({
    orderBy: { createdAt: "desc" },
  });

  if (invitations.length === 0) {
    console.log("\nNo beta invitations found.\n");
    return;
  }

  console.log(`\n✓ Found ${invitations.length} beta invitation(s):\n`);
  
  for (const invitation of invitations) {
    console.log("─".repeat(50));
    printInvitation(invitation);
  }
  console.log("─".repeat(50));
  console.log("");
}

async function createInvitation(email: string) {
  try {
    const result = await issueBetaInvitation(email);

    console.log("\n✓ Beta invitation created!\n");
    printInvitation(result.invitation);
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

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error("Usage:");
    console.error("  npm run beta:invite <email>         Create a new invitation");
    console.error("  npm run beta:invite lookup <email>  Look up existing invitation");
    console.error("  npm run beta:invite list            List all invitations");
    process.exit(1);
  }

  if (args[0] === "list") {
    await listInvitations();
    return;
  }

  if (args[0] === "lookup") {
    const email = args[1];
    if (!email || !email.includes("@")) {
      console.error("Error: Please provide a valid email address");
      console.error("Usage: npm run beta:invite lookup <email>");
      process.exit(1);
    }
    await lookupInvitation(email);
    return;
  }

  const email = args[0];
  if (!email.includes("@")) {
    console.error("Error: Invalid email address");
    process.exit(1);
  }

  await createInvitation(email);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

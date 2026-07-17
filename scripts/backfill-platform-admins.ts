/**
 * Backfill Platform Admins Migration Script
 *
 * Run this script AFTER deploying the isPlatformAdmin migration
 * to set isPlatformAdmin=true for users listed in PLATFORM_ADMIN_EMAILS.
 *
 * Usage:
 *   npx tsx scripts/backfill-platform-admins.ts
 *
 * This script is idempotent and safe to run multiple times.
 */

import { prisma } from "../app/src/lib/prisma";

async function backfillPlatformAdmins() {
  const envEmails = process.env.PLATFORM_ADMIN_EMAILS;

  if (!envEmails) {
    console.log("No PLATFORM_ADMIN_EMAILS environment variable set.");
    console.log("Skipping backfill.");
    return;
  }

  const emails = envEmails
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  if (emails.length === 0) {
    console.log("PLATFORM_ADMIN_EMAILS is empty.");
    return;
  }

  console.log(`Found ${emails.length} email(s) in PLATFORM_ADMIN_EMAILS:`);
  emails.forEach((e) => console.log(`  - ${e}`));

  // Check current state
  const existingAdmins = await prisma.user.count({
    where: { isPlatformAdmin: true },
  });
  console.log(`\nCurrent platform admins in database: ${existingAdmins}`);

  // Update users
  const result = await prisma.user.updateMany({
    where: {
      email: { in: emails },
      isPlatformAdmin: false,
    },
    data: {
      isPlatformAdmin: true,
    },
  });

  console.log(`\nUpdated ${result.count} user(s) to isPlatformAdmin=true`);

  // Verify
  const users = await prisma.user.findMany({
    where: { email: { in: emails } },
    select: { email: true, isPlatformAdmin: true },
  });

  console.log("\nVerification:");
  users.forEach((u) => {
    const status = u.isPlatformAdmin ? "✓ admin" : "✗ not admin";
    console.log(`  ${u.email}: ${status}`);
  });

  const notFound = emails.filter((e) => !users.some((u) => u.email === e));
  if (notFound.length > 0) {
    console.log("\nWarning: These emails from PLATFORM_ADMIN_EMAILS have no user accounts:");
    notFound.forEach((e) => console.log(`  - ${e}`));
  }

  const finalCount = await prisma.user.count({
    where: { isPlatformAdmin: true },
  });
  console.log(`\nFinal platform admin count: ${finalCount}`);
}

backfillPlatformAdmins()
  .then(() => {
    console.log("\nBackfill complete.");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Backfill failed:", error);
    process.exit(1);
  });

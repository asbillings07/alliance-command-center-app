import "dotenv/config";
import { prisma } from "@/app/src/lib/prisma";
import {
  LeadershipNoteType,
  LeadershipNoteVisibility,
  Metric_Type,
} from "@/app/generated/prisma/enums";
import {
  createUser,
  createAlliance,
  createAllianceMembership,
  createLeadershipNote,
  createMembers,
  createMetricPeriod,
  createMetric,
  assignMetricToPeriod,
  recordMemberMetric,
} from "./helpers";

// Test password used for all seeded users
const TEST_PASSWORD = "Password123";

// ---------------------------------------
// Members data
// ---------------------------------------

const members = [
  {
    playerName: "Dragon",
    thp: 210000000,
    squadPower: 350000000,
  },
  {
    playerName: "Val",
    thp: 180000000,
    squadPower: 300000000,
  },
  {
    playerName: "BF",
    thp: 175000000,
    squadPower: 290000000,
  },
  {
    playerName: "Inosuke",
    thp: 165000000,
    squadPower: 280000000,
  },
  {
    playerName: "Mando",
    thp: 261000000,
    squadPower: 80000000,
  },
];

// ---------------------------------------
// Test user emails
// ---------------------------------------
const TEST_USERS = {
  owner: "owner@test.local",
  admin: "admin@test.local",
  leader: "leader@test.local",
  viewer: "viewer@test.local",
  platformAdmin: "platform-admin@test.local",
  otherOwner: "other-owner@test.local",
};

// ---------------------------------------
// Create alliance data
// ---------------------------------------

const createAllianceData = async () => {
  // Create primary test alliance
  const alliance = await createAlliance("DAY1", "999");

  // Create owner user
  const ownerUser = await createUser(TEST_USERS.owner, TEST_PASSWORD, {
    displayName: "Test Owner",
  });

  await createMembers(alliance.id, members);

  // Link Mando to the owner (the owner's roster entry)
  const mando = await prisma.allianceMember.findFirst({
    where: {
      playerName: "Mando",
      allianceId: alliance.id,
    },
  });

  if (!mando) {
    throw new Error("Mando not found");
  }

  await prisma.allianceMember.update({
    where: { id: mando.id },
    data: { userId: ownerUser.id },
  });

  // Create owner membership
  await createAllianceMembership(alliance.id, ownerUser.id, "OWNER");

  // Create admin user and membership
  const adminUser = await createUser(TEST_USERS.admin, TEST_PASSWORD, {
    displayName: "Test Admin",
  });
  await createAllianceMembership(alliance.id, adminUser.id, "ADMIN");

  // Link Val to admin
  const val = await prisma.allianceMember.findFirst({
    where: { playerName: "Val", allianceId: alliance.id },
  });
  if (val) {
    await prisma.allianceMember.update({
      where: { id: val.id },
      data: { userId: adminUser.id },
    });
  }

  // Create leader user and membership
  const leaderUser = await createUser(TEST_USERS.leader, TEST_PASSWORD, {
    displayName: "Test Leader",
  });
  await createAllianceMembership(alliance.id, leaderUser.id, "LEADER");

  // Link BF to leader
  const bf = await prisma.allianceMember.findFirst({
    where: { playerName: "BF", allianceId: alliance.id },
  });
  if (bf) {
    await prisma.allianceMember.update({
      where: { id: bf.id },
      data: { userId: leaderUser.id },
    });
  }

  // Create viewer user and membership
  const viewerUser = await createUser(TEST_USERS.viewer, TEST_PASSWORD, {
    displayName: "Test Viewer",
  });
  await createAllianceMembership(alliance.id, viewerUser.id, "VIEWER");

  // Link Inosuke to viewer
  const inosuke = await prisma.allianceMember.findFirst({
    where: { playerName: "Inosuke", allianceId: alliance.id },
  });
  if (inosuke) {
    await prisma.allianceMember.update({
      where: { id: inosuke.id },
      data: { userId: viewerUser.id },
    });
  }

  const dragon = await prisma.allianceMember.findFirst({
    where: {
      playerName: "Dragon",
      allianceId: alliance.id,
    },
  });

  if (!dragon) {
    throw new Error("Dragon not found");
  }

  return {
    alliance,
    ownerUser,
    adminUser,
    leaderUser,
    viewerUser,
    dragon,
  };
};

// ---------------------------------------
// Create second alliance for tenant isolation tests
// ---------------------------------------

const createSecondAlliance = async () => {
  const alliance = await createAlliance("OTHER", "888");

  const otherOwner = await createUser(TEST_USERS.otherOwner, TEST_PASSWORD, {
    displayName: "Other Owner",
  });

  await createAllianceMembership(alliance.id, otherOwner.id, "OWNER");

  // Create some members in this alliance
  await createMembers(alliance.id, [
    { playerName: "Alpha", thp: 100000000, squadPower: 200000000 },
    { playerName: "Beta", thp: 90000000, squadPower: 180000000 },
  ]);

  return { alliance, otherOwner };
};

// ---------------------------------------
// Create platform admin user
// (Must also be added to PLATFORM_ADMIN_EMAILS env var)
// ---------------------------------------

const createPlatformAdmin = async () => {
  return await createUser(TEST_USERS.platformAdmin, TEST_PASSWORD, {
    displayName: "Platform Admin",
  });
};

const createMetricData = async (allianceId: string, memberId: string) => {
  // ---------------------------------------
  // Metric Periods
  // ---------------------------------------
  const season7 = await createMetricPeriod(allianceId, "Season 7");
  const season7Offseason = await createMetricPeriod(
    allianceId,
    "Season 7 Offseason",
  );
  const vsScore = await createMetric(
    allianceId,
    "VS Score",
    "The score of the alliance in the VS game",
    Metric_Type.NUMERIC,
  );
  const desertStorm = await createMetric(
    allianceId,
    "Desert Storm",
    "The score of the alliance in the Desert Storm game",
    Metric_Type.NUMERIC,
  );
  // ---------------------------------------

  await assignMetricToPeriod(season7.id, vsScore.id, 20, true);
  await assignMetricToPeriod(season7.id, desertStorm.id, 10, true);
  await assignMetricToPeriod(season7Offseason.id, vsScore.id, 30, true);
  await assignMetricToPeriod(season7Offseason.id, desertStorm.id, 25, true);

  await recordMemberMetric(
    memberId,
    season7.id,
    vsScore.id,
    10000000,
    new Date(),
  );
  await recordMemberMetric(
    memberId,
    season7.id,
    desertStorm.id,
    5000000,
    new Date(),
  );
  await recordMemberMetric(
    memberId,
    season7Offseason.id,
    vsScore.id,
    8000000,
    new Date(),
  );
  await recordMemberMetric(
    memberId,
    season7Offseason.id,
    desertStorm.id,
    700000000,
    new Date(),
  );
};

// ---------------------------------------
// Main function
// ---------------------------------------

async function main() {
  console.log("🌱 Starting seed...\n");

  // Primary Alliance with all role users
  const { alliance, ownerUser, dragon } = await createAllianceData();
  console.log("✓ Created primary alliance (DAY1) with test users");

  // Second alliance for tenant isolation tests
  const { alliance: otherAlliance } = await createSecondAlliance();
  console.log("✓ Created secondary alliance (OTHER) for tenant isolation");

  // Platform admin
  await createPlatformAdmin();
  console.log("✓ Created platform admin user");

  // Leadership Notes
  await createLeadershipNote(
    dragon.id,
    ownerUser.id,
    LeadershipNoteType.POSITIVE,
    LeadershipNoteVisibility.LEADERSHIP,
    "Dragon is a great leader"
  );
  console.log("✓ Created leadership notes");

  // Metrics
  await createMetricData(alliance.id, dragon.id);
  console.log("✓ Created metrics and periods");

  // Output environment variables for E2E tests
  console.log("\n" + "=".repeat(60));
  console.log("E2E TEST ENVIRONMENT VARIABLES");
  console.log("=".repeat(60));
  console.log("Copy these to your .env.test file:\n");

  console.log("# Primary test alliance");
  console.log(`TEST_ALLIANCE_ID=${alliance.id}`);
  console.log(`TEST_MEMBER_ID=${dragon.id}`);
  console.log("");
  console.log("# Owner credentials");
  console.log(`TEST_OWNER_EMAIL=${TEST_USERS.owner}`);
  console.log(`TEST_OWNER_PASSWORD=${TEST_PASSWORD}`);
  console.log("");
  console.log("# Admin credentials");
  console.log(`TEST_ADMIN_EMAIL=${TEST_USERS.admin}`);
  console.log(`TEST_ADMIN_PASSWORD=${TEST_PASSWORD}`);
  console.log("");
  console.log("# Leader credentials");
  console.log(`TEST_LEADER_EMAIL=${TEST_USERS.leader}`);
  console.log(`TEST_LEADER_PASSWORD=${TEST_PASSWORD}`);
  console.log("");
  console.log("# Viewer credentials");
  console.log(`TEST_VIEWER_EMAIL=${TEST_USERS.viewer}`);
  console.log(`TEST_VIEWER_PASSWORD=${TEST_PASSWORD}`);
  console.log("");
  console.log("# Other alliance (for tenant isolation tests)");
  console.log(`TEST_OTHER_ALLIANCE_ID=${otherAlliance.id}`);
  console.log("");
  console.log("# Platform admin credentials");
  console.log(`TEST_PLATFORM_ADMIN_EMAIL=${TEST_USERS.platformAdmin}`);
  console.log(`TEST_PLATFORM_ADMIN_PASSWORD=${TEST_PASSWORD}`);
  console.log("");
  console.log("# Add this to your main .env to enable platform admin access:");
  console.log(`PLATFORM_ADMIN_EMAILS=${TEST_USERS.platformAdmin}`);
  console.log("");
  console.log("=".repeat(60));
  console.log("\n🌱 Seed completed successfully!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

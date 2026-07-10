import "dotenv/config";
import { prisma } from "@/app/src/lib/prisma";
import {
  LeadershipNoteType,
  LeadershipNoteVisibility,
  Metric_Type,
} from "@/app/generated/prisma/enums";
import {
  createUser,
  createLeadershipNote,
  createMembers,
  createMetricPeriod,
  createMetric,
  assignMetricToPeriod,
  recordMemberMetric,
} from "./helpers";

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
// Create alliance data
// ---------------------------------------

const createAllianceData = async () => {
  const alliance = await prisma.alliance.upsert({
    where: {
      name_server: {
        name: "DAY1",
        server: "999",
      },
    },
    update: {},
    create: {
      name: "DAY1",
      server: "999",
    },
  });

  const user = await prisma.user.findUnique({
    where: {
      email: "abdevelops@gmail.com",
    },
  });
  if (!user) {
    throw new Error("User not found");
  }

  await createMembers(alliance.id, members);

  // Link Mando to the user (the owner's roster entry)
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
    data: { userId: user.id },
  });

  // Alliance Membership
  await prisma.allianceMembership.upsert({
    where: {
      allianceId_userId: {
        allianceId: alliance.id,
        userId: user.id,
      },
    },
    update: {},
    create: {
      allianceId: alliance.id,
      userId: user.id,
      role: "OWNER",
    },
  });

  const dragon = await prisma.allianceMember.findFirst({
    where: {
      playerName: "Dragon",
      allianceId: alliance.id,
    },
  });

  if (!dragon) {
    throw new Error("Dragon not found");
  }

  return { alliance, user, dragon };
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
  // Users
  await createUser("abdevelops@gmail.com", "Password123");

  // Alliance
  const { alliance, user, dragon } = await createAllianceData();

  // Leadership Notes
  await createLeadershipNote(
    dragon.id,
    user.id,
    LeadershipNoteType.POSITIVE,
    LeadershipNoteVisibility.LEADERSHIP,
    "Dragon is a great leader",
  );

  // ---------------------------------------
  // Metrics
  // ---------------------------------------
  await createMetricData(alliance.id, dragon.id);

  console.log("🌱 Seed completed successfully");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

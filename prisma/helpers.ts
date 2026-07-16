import bcrypt from "bcrypt";
import { prisma } from "@/app/src/lib/prisma";
import { LeadershipNoteType, Metric_Type } from "@/app/generated/prisma/enums";
import { LeadershipNoteVisibility } from "@/app/generated/prisma/enums";

/**
 * Create a new user
 * @param email - The email of the user
 * @param password - The password of the user
 * @returns The created user
 */

const createUser = async (
  email: string,
  password: string,
  options?: { displayName?: string }
) => {
  const existing = await prisma.user.findUnique({
    where: { email },
  });

  if (existing) {
    return existing;
  }

  const passwordHash = await bcrypt.hash(password, 12);

  return await prisma.user.create({
    data: {
      email,
      displayName: options?.displayName ?? email.split("@")[0],
      passwordHash,
    },
  });
};

/**
 * Create a new leadership note
 * @param allianceMemberId - The ID of the alliance member
 * @param authorId - The ID of the author
 * @param noteType - The type of the note
 * @param visibility - The visibility of the note
 * @param content - The content of the note
 * @returns The created leadership note
 */
const createLeadershipNote = async (
  allianceMemberId: string,
  authorId: string,
  noteType: LeadershipNoteType,
  visibility: LeadershipNoteVisibility,
  content: string,
) => {
  const existing = await prisma.leadershipNote.findFirst({
    where: {
      allianceMemberId,
      authorId,
      noteType,
      visibility,
      content,
    },
    select: { id: true },
  });

  if (existing) return;

  return await prisma.leadershipNote.create({
    data: {
      allianceMemberId,
      authorId,
      noteType,
      visibility,
      content,
    },
  });
};

// example metric: VS Score
/**
 * Create a new metric
 * @param allianceId - The ID of the alliance
 * @param name - The name of the metric
 * @param description - The description of the metric
 * @param type - The type of the metric
 * @returns The created metric
 */
const createMetric = async (
  allianceId: string,
  name: string,
  description: string,
  type: Metric_Type,
) => {
  const existing = await prisma.metric.findUnique({
    where: {
      allianceId_name: {
        allianceId,
        name,
      },
    },
  });

  if (existing) return existing;

  return await prisma.metric.create({
    data: {
      allianceId,
      name,
      description,
      type,
    },
  });
};

// example period: Season 7
/**
 * Create a new metric period
 * @param allianceId - The ID of the alliance
 * @param name - The name of the period
 * @returns The created metric period
 */
const createMetricPeriod = async (allianceId: string, name: string) => {
  const existing = await prisma.metricPeriod.findFirst({
    where: {
      allianceId,
      name,
    },
  });

  if (existing) return existing;

  const period = await prisma.metricPeriod.create({
    data: {
      allianceId,
      name,
    },
  });

  return period;
};

// example entry: 92
/**
 * Record a new metric entry for an alliance member (appends to history)
 * @param allianceMemberId - The ID of the alliance member
 * @param periodId - The ID of the period
 * @param metricId - The ID of the metric
 * @param value - The value of the metric
 * @param recordedAt - The date and time the metric was recorded
 * @returns The created metric entry
 */
const recordMemberMetric = async (
  allianceMemberId: string,
  periodId: string,
  metricId: string,
  value: number,
  recordedAt: Date,
) => {
  return await prisma.memberMetricEntry.create({
    data: {
      allianceMemberId,
      periodId,
      metricId,
      value,
      recordedAt,
    },
  });
};

/**
 * Assign a metric to a period
 * @param periodId - The ID of the period
 * @param metricId - The ID of the metric
 * @param weight - The weight of the metric
 * @param required - Whether the metric is required
 * @returns The created metric period metric
 */
const assignMetricToPeriod = async (
  periodId: string,
  metricId: string,
  weight: number,
  required: boolean,
) => {
  const existing = await prisma.metricPeriodMetric.findFirst({
    where: {
      periodId,
      metricId,
    },
  });

  if (existing) return existing;

  return await prisma.metricPeriodMetric.create({
    data: {
      periodId,
      metricId,
      weight,
      required,
    },
  });
};

/**
 * Create a new alliance member
 * @param allianceId - The ID of the alliance
 * @param playerName - The name of the player
 * @returns The created alliance member
 */
const createAllianceMember = async (allianceId: string, playerName: string) => {
  return await prisma.allianceMember.upsert({
    where: {
      allianceId_playerName: {
        allianceId,
        playerName,
      },
    },
    update: {},
    create: {
      allianceId,
      playerName,
    },
  });
};

/**
 * Create multiple alliance members
 * @param allianceId - The ID of the alliance
 * @param members - The members to create
 * @returns The created alliance members
 */
const createMembers = async (
  allianceId: string,
  members: { playerName: string; thp: number; squadPower: number }[],
) => {
  return await Promise.all(
    members.map((member) =>
      prisma.allianceMember.upsert({
        where: {
          allianceId_playerName: {
            allianceId,
            playerName: member.playerName,
          },
        },
        update: {
          thp: member.thp,
          squadPower: member.squadPower,
        },
        create: {
          allianceId,
          playerName: member.playerName,
          thp: member.thp,
          squadPower: member.squadPower,
        },
      }),
    ),
  );
};

/**
 * Create an alliance membership (user to alliance link with role)
 * @param allianceId - The ID of the alliance
 * @param userId - The ID of the user
 * @param role - The role of the user in the alliance
 * @returns The created alliance membership
 */
const createAllianceMembership = async (
  allianceId: string,
  userId: string,
  role: "OWNER" | "ADMIN" | "LEADER" | "VIEWER"
) => {
  return await prisma.allianceMembership.upsert({
    where: {
      allianceId_userId: {
        allianceId,
        userId,
      },
    },
    update: { role },
    create: {
      allianceId,
      userId,
      role,
    },
  });
};

/**
 * Create an alliance
 * @param name - The name of the alliance
 * @param server - The server of the alliance
 * @returns The created alliance
 */
const createAlliance = async (name: string, server: string) => {
  return await prisma.alliance.upsert({
    where: {
      name_server: {
        name,
        server,
      },
    },
    update: {},
    create: {
      name,
      server,
    },
  });
};

export {
  createUser,
  createAlliance,
  createAllianceMember,
  createAllianceMembership,
  createMembers,
  createLeadershipNote,
  createMetric,
  createMetricPeriod,
  recordMemberMetric,
  assignMetricToPeriod,
};

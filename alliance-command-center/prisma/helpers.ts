import bcrypt from "bcrypt";
import { prisma } from "@/app/src/lib/prisma";
import { LeadershipNoteType, Metric_Type } from "@/app/generated/prisma/enums";
import { LeadershipNoteVisibility } from "@/app/generated/prisma/enums";

const createUser = async (email: string, password: string) => {
  const passwordHash = await bcrypt.hash(password, 12);

  return await prisma.user.upsert({
    where: {
      email,
    },
    update: {},
    create: {
      email,
      displayName: "AB",
      passwordHash,
    },
  });
};

const createLeadershipNote = async (
  memberId: string,
  authorId: string,
  noteType: LeadershipNoteType,
  visibility: LeadershipNoteVisibility,
  content: string,
) => {
  const existing = await prisma.leadershipNote.findFirst({
    where: {
      memberId,
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
      memberId,
      authorId,
      noteType,
      visibility,
      content,
    },
  });
};

// example metric: VS Score
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
const createMetricPeriod = async (allianceId: string, name: string) => {
  const existing = await prisma.metricPeriod.findFirst({
    where: {
      allianceId,
      name,
    },
  });

  if (existing) return existing;

  const metric = await prisma.metricPeriod.create({
    data: {
      allianceId,
      name,
    },
  });

  return metric;
};

// example entry: 92
const recordMemberMetric = async (
  memberId: string,
  periodId: string,
  metricId: string,
  value: number,
  recordedAt: Date,
) => {
  return await prisma.memberMetricEntry.create({
    data: {
      memberId,
      periodId,
      metricId,
      value,
      recordedAt,
    },
  });
};

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

const createMember = async (allianceId: string, playerName: string) => {
  return await prisma.member.upsert({
    where: {
      playerName,
    },
    update: {},
    create: {
      allianceId,
      playerName,
    },
  });
};

const createMembers = async (
  allianceId: string,
  members: { playerName: string; thp: number; squadPower: number }[],
) => {
  return await prisma.member.createMany({
    data: members.map((member) => ({
      allianceId,
      playerName: member.playerName,
    })),
    skipDuplicates: true,
  });
};

export {
  createUser,
  createMember,
  createMembers,
  createLeadershipNote,
  createMetric,
  createMetricPeriod,
  recordMemberMetric,
  assignMetricToPeriod,
};

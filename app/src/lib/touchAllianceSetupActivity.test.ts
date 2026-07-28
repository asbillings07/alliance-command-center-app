import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { touchAllianceSetupActivity } from "./touchAllianceSetupActivity";

const runDb = process.env.INTEGRATION_DB === "true";

describe("touchAllianceSetupActivity [unit]", () => {
  it("executes an atomic GREATEST update for the alliance", async () => {
    const executeRaw = vi.fn().mockResolvedValue(1);
    const tx = { $executeRaw: executeRaw };
    const candidate = new Date("2026-07-01T12:00:00.000Z");

    await touchAllianceSetupActivity(
      tx as unknown as Parameters<typeof touchAllianceSetupActivity>[0],
      "alliance-1",
      candidate,
    );

    expect(executeRaw).toHaveBeenCalledOnce();
    const values = executeRaw.mock.calls[0].slice(1);
    expect(values).toContain("alliance-1");
    expect(values).toContainEqual(candidate);
    expect(String(executeRaw.mock.calls[0][0])).toContain("GREATEST");
    expect(String(executeRaw.mock.calls[0][0])).toContain("setupActivityAt");
  });
});

describe.skipIf(!runDb)("touchAllianceSetupActivity [integration]", () => {
  const createdAllianceIds: string[] = [];

  beforeEach(async () => {
    const { prisma } = await import("./prisma");
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const alliance = await prisma.alliance.create({
      data: {
        name: `Setup Activity ${suffix}`,
        server: "S1",
        setupActivityAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    });
    createdAllianceIds.push(alliance.id);
  });

  afterEach(async () => {
    const { prisma } = await import("./prisma");
    if (createdAllianceIds.length > 0) {
      await prisma.alliance.deleteMany({
        where: { id: { in: createdAllianceIds } },
      });
      createdAllianceIds.length = 0;
    }
  });

  it("advances setupActivityAt when candidate is later", async () => {
    const { prisma } = await import("./prisma");
    const allianceId = createdAllianceIds[0];
    const later = new Date("2026-06-01T00:00:00.000Z");

    await prisma.$transaction(async (tx) => {
      await touchAllianceSetupActivity(tx, allianceId, later);
    });

    const row = await prisma.alliance.findUniqueOrThrow({
      where: { id: allianceId },
      select: { setupActivityAt: true },
    });
    expect(row.setupActivityAt).toEqual(later);
  });

  it("does not move setupActivityAt backward when candidate is earlier", async () => {
    const { prisma } = await import("./prisma");
    const allianceId = createdAllianceIds[0];
    const earlier = new Date("2025-06-01T00:00:00.000Z");

    await prisma.$transaction(async (tx) => {
      await touchAllianceSetupActivity(tx, allianceId, earlier);
    });

    const row = await prisma.alliance.findUniqueOrThrow({
      where: { id: allianceId },
      select: { setupActivityAt: true },
    });
    expect(row.setupActivityAt).toEqual(new Date("2026-01-01T00:00:00.000Z"));
  });

  it("does not regress when an earlier candidate commits after a later one", async () => {
    const { prisma } = await import("./prisma");
    const allianceId = createdAllianceIds[0];
    const earlier = new Date("2026-03-01T00:00:00.000Z");
    const later = new Date("2026-09-01T00:00:00.000Z");

    await prisma.$transaction(async (tx) => {
      await touchAllianceSetupActivity(tx, allianceId, later);
    });

    await prisma.$transaction(async (tx) => {
      await touchAllianceSetupActivity(tx, allianceId, earlier);
    });

    const row = await prisma.alliance.findUniqueOrThrow({
      where: { id: allianceId },
      select: { setupActivityAt: true },
    });
    expect(row.setupActivityAt).toEqual(later);
  });
});

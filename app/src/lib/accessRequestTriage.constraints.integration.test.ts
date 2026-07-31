import { describe, it, expect, beforeAll, afterEach } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";

const runDb = process.env.INTEGRATION_DB === "true";
const describeIntegration = runDb ? describe.sequential : describe.skip;

/**
 * Defense-in-depth verification for the hand-written CHECK constraints added
 * in the access_request_triage migration (#177). The application
 * (accessRequestTriage.ts) never produces these shapes; these tests confirm
 * a bug there could never persist an inconsistent row, by attempting the
 * violation directly via raw SQL against AccessRequestTriageEvent.
 */
describeIntegration("AccessRequestTriageEvent CHECK constraints [integration]", () => {
  const createdAccessRequestIds: string[] = [];

  let prisma: PrismaClient;

  beforeAll(async () => {
    ({ prisma } = (await import("./prisma")) as unknown as { prisma: PrismaClient });
  });

  afterEach(async () => {
    if (createdAccessRequestIds.length > 0) {
      await prisma.accessRequestTriageEvent.deleteMany({
        where: { accessRequestId: { in: createdAccessRequestIds } },
      });
      await prisma.accessRequestTriage.deleteMany({
        where: { accessRequestId: { in: createdAccessRequestIds } },
      });
      await prisma.accessRequest.deleteMany({ where: { id: { in: createdAccessRequestIds } } });
      createdAccessRequestIds.length = 0;
    }
  });

  async function makeAccessRequest() {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const request = await prisma.accessRequest.create({
      data: { name: "Applicant", email: `constraint-${suffix}@example.test` },
    });
    createdAccessRequestIds.push(request.id);
    return request;
  }

  it("rejects a DECLINED event whose previousStatus is not PENDING", async () => {
    const request = await makeAccessRequest();
    await expect(
      prisma.accessRequestTriageEvent.create({
        data: {
          accessRequestId: request.id,
          eventType: "DECLINED",
          previousStatus: "DECLINED",
          nextStatus: "DECLINED",
          declineReason: "bad transition",
          actorEmail: "actor@example.test",
        },
      }),
    ).rejects.toThrow();
  });

  it("rejects a NOTE_ADDED event with an empty noteText", async () => {
    const request = await makeAccessRequest();
    await expect(
      prisma.accessRequestTriageEvent.create({
        data: {
          accessRequestId: request.id,
          eventType: "NOTE_ADDED",
          previousStatus: "PENDING",
          nextStatus: "PENDING",
          noteText: "",
          actorEmail: "actor@example.test",
        },
      }),
    ).rejects.toThrow();
  });

  it("rejects a CONVERSION_BLOCKED event with blockedConflictType = NONE", async () => {
    const request = await makeAccessRequest();
    await expect(
      prisma.accessRequestTriageEvent.create({
        data: {
          accessRequestId: request.id,
          eventType: "CONVERSION_BLOCKED",
          previousStatus: "PENDING",
          nextStatus: "PENDING",
          blockedReason: "should not be allowed",
          blockedConflictType: "NONE",
          actorEmail: "actor@example.test",
        },
      }),
    ).rejects.toThrow();
  });

  it("rejects an INVITED event with no linkedInvitationId", async () => {
    const request = await makeAccessRequest();
    await expect(
      prisma.accessRequestTriageEvent.create({
        data: {
          accessRequestId: request.id,
          eventType: "INVITED",
          previousStatus: "PENDING",
          nextStatus: "INVITED",
          betaWave: "Wave 1",
          actorEmail: "actor@example.test",
        },
      }),
    ).rejects.toThrow();
  });

  it("rejects a blocked EXISTING_PARTICIPANT_REISSUE event with two participant snapshots instead of one", async () => {
    const request = await makeAccessRequest();
    await expect(
      prisma.accessRequestTriageEvent.create({
        data: {
          accessRequestId: request.id,
          eventType: "CONVERSION_BLOCKED",
          previousStatus: "PENDING",
          nextStatus: "PENDING",
          blockedReason: "reissue conflict",
          blockedConflictType: "EXISTING_PARTICIPANT_REISSUE",
          conflictParticipantIdSnapshots: ["participant-a", "participant-b"],
          actorEmail: "actor@example.test",
        },
      }),
    ).rejects.toThrow();
  });

  it("rejects a RESOLVED_EXISTING_ACCESS event missing conflict evidence", async () => {
    const request = await makeAccessRequest();
    await expect(
      prisma.accessRequestTriageEvent.create({
        data: {
          accessRequestId: request.id,
          eventType: "RESOLVED_EXISTING_ACCESS",
          previousStatus: "PENDING",
          nextStatus: "RESOLVED_EXISTING_ACCESS",
          resolutionReason: "already has access",
          actorEmail: "actor@example.test",
        },
      }),
    ).rejects.toThrow();
  });

  it("accepts a well-formed IDENTITY_AMBIGUOUS blocked event with a single flagged-participant snapshot", async () => {
    const request = await makeAccessRequest();
    const event = await prisma.accessRequestTriageEvent.create({
      data: {
        accessRequestId: request.id,
        eventType: "CONVERSION_BLOCKED",
        previousStatus: "PENDING",
        nextStatus: "PENDING",
        blockedReason: "identity ambiguous",
        blockedConflictType: "IDENTITY_AMBIGUOUS",
        conflictParticipantIdSnapshots: ["participant-a"],
        actorEmail: "actor@example.test",
      },
    });
    expect(event.id).toBeDefined();
  });

  it("rejects an AccessRequestTriage projection stuck as INVITED without a linkedInvitationId", async () => {
    const request = await makeAccessRequest();
    await prisma.accessRequestTriage.create({
      data: { accessRequestId: request.id, status: "PENDING" },
    });
    await expect(
      prisma.accessRequestTriage.update({
        where: { accessRequestId: request.id },
        data: { status: "INVITED" },
      }),
    ).rejects.toThrow();
  });
});

import { describe, it, expect, beforeAll, afterEach } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";
import type * as FeedbackTriageModule from "./feedbackTriage";
import {
  clearFeedbackTriageTestHooks,
  setFeedbackTriageAfterLockHook,
  setFeedbackTriageBeforeLockHook,
} from "./feedbackTriageTestHooks";

const runDb = process.env.INTEGRATION_DB === "true";
const describeIntegration = runDb ? describe.sequential : describe.skip;

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function enableBarrierHooks() {
  process.env.FEEDBACK_TRIAGE_TEST_HOOKS = "true";
}

describeIntegration("feedbackTriage atomic mutations [integration]", () => {
  const createdFeedbackIds: string[] = [];
  const createdUserIds: string[] = [];

  let prisma: PrismaClient;
  let recordFeedbackTriageEvent: typeof FeedbackTriageModule.recordFeedbackTriageEvent;
  let createFeedback: typeof import("./feedback").createFeedback;

  beforeAll(async () => {
    ({ prisma } = (await import("./prisma")) as unknown as {
      prisma: PrismaClient;
    });
    ({ recordFeedbackTriageEvent } = await import("./feedbackTriage"));
    ({ createFeedback } = await import("./feedback"));
  });

  afterEach(async () => {
    clearFeedbackTriageTestHooks();
    delete process.env.FEEDBACK_TRIAGE_TEST_HOOKS;
    if (createdFeedbackIds.length > 0) {
      await prisma.feedbackTriageEvent.deleteMany({
        where: { feedbackId: { in: createdFeedbackIds } },
      });
      await prisma.feedbackTriage.deleteMany({
        where: { feedbackId: { in: createdFeedbackIds } },
      });
      await prisma.feedback.deleteMany({
        where: { id: { in: createdFeedbackIds } },
      });
      createdFeedbackIds.length = 0;
    }
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      createdUserIds.length = 0;
    }
  });

  async function makeUser(label: string) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const user = await prisma.user.create({
      data: {
        email: `${label}-${suffix}@example.test`,
        displayName: `${label} Operator`,
        passwordHash: "placeholder-hash-not-a-real-password",
        sessionVersion: 0,
      },
    });
    createdUserIds.push(user.id);
    return user;
  }

  async function makeFeedback(userId: string, withTriage = true) {
    const feedback = await createFeedback({
      userId,
      category: "BUG",
      message: "concurrency test",
      url: "/alliances/a1/members",
    });
    createdFeedbackIds.push(feedback.id);
    if (!withTriage) {
      await prisma.feedbackTriage.delete({ where: { feedbackId: feedback.id } });
    }
    return feedback;
  }

  it("rejects competing state changes — one succeeds, one stale-conflicts with winner identity", async () => {
    const submitter = await makeUser("submitter");
    const opA = await makeUser("operator-a");
    const opB = await makeUser("operator-b");
    const feedback = await makeFeedback(submitter.id);

    const first = await recordFeedbackTriageEvent(
      feedback.id,
      opA.id,
      { status: "TRIAGED" },
      0,
    );
    expect(first.ok).toBe(true);

    const second = await recordFeedbackTriageEvent(
      feedback.id,
      opB.id,
      { status: "PLANNED" },
      0,
    );
    expect(second).toEqual({
      ok: false,
      code: "STALE_CONFLICT",
      conflict: {
        status: "TRIAGED",
        needsResponse: true,
        githubIssueUrl: null,
        stateRevision: 1,
        lastStateChangeAt: expect.any(Date),
        lastStateChangeActorEmail: opA.email,
        lastStateChangeActorDisplayName: opA.displayName,
      },
    });
  });

  it("allows note-only concurrent with state change without causing later stale rejection", async () => {
    const submitter = await makeUser("submitter");
    const stateOp = await makeUser("state-op");
    const noteOp = await makeUser("note-op");
    const feedback = await makeFeedback(submitter.id);

    const [stateResult, noteResult] = await Promise.all([
      recordFeedbackTriageEvent(feedback.id, stateOp.id, { status: "TRIAGED" }, 0),
      recordFeedbackTriageEvent(feedback.id, noteOp.id, { note: "parallel note" }, 0),
    ]);

    expect(stateResult.ok).toBe(true);
    expect(noteResult.ok).toBe(true);

    if (stateResult.ok) {
      expect(stateResult.projection.stateRevision).toBe(1);
    }

    const followUp = await recordFeedbackTriageEvent(
      feedback.id,
      stateOp.id,
      { status: "PLANNED" },
      1,
    );
    expect(followUp.ok).toBe(true);
    if (followUp.ok) {
      expect(followUp.projection.stateRevision).toBe(2);
    }
  });

  it("state change wins lock before concurrent note (barrier ordering A)", async () => {
    enableBarrierHooks();
    const submitter = await makeUser("submitter");
    const stateOp = await makeUser("state-op");
    const noteOp = await makeUser("note-op");
    const feedback = await makeFeedback(submitter.id);

    const stateLocked = createDeferred<void>();
    const releaseState = createDeferred<void>();
    const noteAttemptingLock = createDeferred<void>();

    setFeedbackTriageAfterLockHook(async (ctx) => {
      if (ctx.operation === "stateChange") {
        stateLocked.resolve(undefined);
        await releaseState.promise;
      }
    });
    setFeedbackTriageBeforeLockHook(async (ctx) => {
      if (ctx.operation === "note") {
        noteAttemptingLock.resolve(undefined);
      }
    });

    const statePromise = recordFeedbackTriageEvent(
      feedback.id,
      stateOp.id,
      { status: "TRIAGED" },
      0,
    );
    await stateLocked.promise;

    const notePromise = recordFeedbackTriageEvent(
      feedback.id,
      noteOp.id,
      { note: "queued note" },
      0,
    );
    await noteAttemptingLock.promise;

    releaseState.resolve(undefined);
    const stateResult = await statePromise;
    const noteResult = await notePromise;

    expect(stateResult.ok).toBe(true);
    expect(noteResult.ok).toBe(true);

    const laterState = await recordFeedbackTriageEvent(
      feedback.id,
      stateOp.id,
      { needsResponse: false },
      stateResult.ok ? stateResult.projection.stateRevision : 0,
    );
    expect(laterState.ok).toBe(true);
  });

  it("note wins lock before concurrent state change (barrier ordering B)", async () => {
    enableBarrierHooks();
    const submitter = await makeUser("submitter");
    const stateOp = await makeUser("state-op");
    const noteOp = await makeUser("note-op");
    const feedback = await makeFeedback(submitter.id);

    const noteLocked = createDeferred<void>();
    const releaseNote = createDeferred<void>();
    const stateAttemptingLock = createDeferred<void>();

    setFeedbackTriageAfterLockHook(async (ctx) => {
      if (ctx.operation === "note") {
        noteLocked.resolve(undefined);
        await releaseNote.promise;
      }
    });
    setFeedbackTriageBeforeLockHook(async (ctx) => {
      if (ctx.operation === "stateChange") {
        stateAttemptingLock.resolve(undefined);
      }
    });

    const notePromise = recordFeedbackTriageEvent(
      feedback.id,
      noteOp.id,
      { note: "first note" },
      0,
    );
    await noteLocked.promise;

    const statePromise = recordFeedbackTriageEvent(
      feedback.id,
      stateOp.id,
      { status: "TRIAGED" },
      0,
    );
    await stateAttemptingLock.promise;

    releaseNote.resolve(undefined);
    const noteResult = await notePromise;
    const stateResult = await statePromise;

    expect(noteResult.ok).toBe(true);
    expect(stateResult.ok).toBe(true);
    if (stateResult.ok) {
      expect(stateResult.projection.stateRevision).toBe(1);
    }

    const followUp = await recordFeedbackTriageEvent(
      feedback.id,
      stateOp.id,
      { status: "PLANNED" },
      stateResult.ok ? stateResult.projection.stateRevision : 0,
    );
    expect(followUp.ok).toBe(true);
  });

  it("lazy projection creation under concurrent first mutations yields exactly one row", async () => {
    const submitter = await makeUser("submitter");
    const opA = await makeUser("operator-a");
    const opB = await makeUser("operator-b");
    const feedback = await makeFeedback(submitter.id, false);

    const results = await Promise.allSettled([
      recordFeedbackTriageEvent(feedback.id, opA.id, { note: "first" }, undefined),
      recordFeedbackTriageEvent(feedback.id, opB.id, { note: "second" }, undefined),
    ]);

    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    for (const r of results) {
      if (r.status === "fulfilled") {
        expect(r.value.ok).toBe(true);
      }
    }

    const projections = await prisma.feedbackTriage.findMany({
      where: { feedbackId: feedback.id },
    });
    expect(projections).toHaveLength(1);
    expect(
      await prisma.feedbackTriageEvent.count({ where: { feedbackId: feedback.id } }),
    ).toBe(2);
  });
});

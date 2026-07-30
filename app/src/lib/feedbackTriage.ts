import type { Prisma } from "@/app/generated/prisma/client";
import type { FeedbackTriageStatus } from "@/app/generated/prisma/enums";
import { prisma } from "./prisma";
import {
  runFeedbackTriageAfterLockHook,
  runFeedbackTriageBeforeLockHook,
  type FeedbackTriageLockOperation,
} from "./feedbackTriageTestHooks";

/** Canonical GitHub issue URL: https://github.com/{owner}/{repo}/issues/{number} */
export const GITHUB_ISSUE_URL_PATTERN =
  /^https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/\d+$/;

export type FeedbackTriageChanges = {
  status?: FeedbackTriageStatus;
  note?: string;
  needsResponse?: boolean;
  /** undefined = untouched; null = explicit clear; string = set. */
  githubIssueUrl?: string | null;
};

export type FeedbackTriageProjection = {
  feedbackId: string;
  status: FeedbackTriageStatus;
  needsResponse: boolean;
  githubIssueUrl: string | null;
  stateRevision: number;
  lastEventAt: Date | null;
  lastStateChangeAt: Date | null;
  lastStateChangeActorEmail: string | null;
  lastStateChangeActorDisplayName: string | null;
};

export type StaleConflictPayload = Pick<
  FeedbackTriageProjection,
  | "status"
  | "needsResponse"
  | "githubIssueUrl"
  | "stateRevision"
  | "lastStateChangeAt"
  | "lastStateChangeActorEmail"
  | "lastStateChangeActorDisplayName"
>;

export type RecordTriageEventResult =
  | { ok: true; projection: FeedbackTriageProjection }
  | { ok: false; code: "NO_CHANGES" }
  | { ok: false; code: "STALE_CONFLICT"; conflict: StaleConflictPayload }
  | { ok: false; code: "VALIDATION"; message: string };

type ResolvedDiff = {
  status?: FeedbackTriageStatus;
  noteText?: string;
  needsResponse?: boolean;
  githubIssueUrlChanged: boolean;
  githubIssueUrlChangedTo?: string | null;
  isStateMutating: boolean;
};

type LockedTriageRow = {
  feedbackId: string;
  status: FeedbackTriageStatus;
  needsResponse: boolean;
  githubIssueUrl: string | null;
  stateRevision: number;
  lastEventAt: Date | null;
  lastStateChangeAt: Date | null;
  lastStateChangeActorEmail: string | null;
  lastStateChangeActorDisplayName: string | null;
};

function toProjection(row: LockedTriageRow): FeedbackTriageProjection {
  return {
    feedbackId: row.feedbackId,
    status: row.status,
    needsResponse: row.needsResponse,
    githubIssueUrl: row.githubIssueUrl,
    stateRevision: row.stateRevision,
    lastEventAt: row.lastEventAt,
    lastStateChangeAt: row.lastStateChangeAt,
    lastStateChangeActorEmail: row.lastStateChangeActorEmail,
    lastStateChangeActorDisplayName: row.lastStateChangeActorDisplayName,
  };
}

function stalePayload(row: LockedTriageRow): StaleConflictPayload {
  return {
    status: row.status,
    needsResponse: row.needsResponse,
    githubIssueUrl: row.githubIssueUrl,
    stateRevision: row.stateRevision,
    lastStateChangeAt: row.lastStateChangeAt,
    lastStateChangeActorEmail: row.lastStateChangeActorEmail,
    lastStateChangeActorDisplayName: row.lastStateChangeActorDisplayName,
  };
}

export function validateGithubIssueUrl(url: string): boolean {
  return GITHUB_ISSUE_URL_PATTERN.test(url);
}

function resolveDiff(
  current: LockedTriageRow,
  changes: FeedbackTriageChanges,
): RecordTriageEventResult | ResolvedDiff {
  const diff: Omit<ResolvedDiff, "isStateMutating"> & {
    isStateMutating?: boolean;
  } = {
    githubIssueUrlChanged: false,
  };

  if (changes.status !== undefined && changes.status !== current.status) {
    diff.status = changes.status;
  }

  if (
    changes.needsResponse !== undefined &&
    changes.needsResponse !== current.needsResponse
  ) {
    diff.needsResponse = changes.needsResponse;
  }

  if (changes.githubIssueUrl !== undefined) {
    if (
      changes.githubIssueUrl !== null &&
      !validateGithubIssueUrl(changes.githubIssueUrl)
    ) {
      return {
        ok: false,
        code: "VALIDATION",
        message:
          "GitHub URL must match https://github.com/{owner}/{repo}/issues/{number}",
      };
    }
    const nextUrl = changes.githubIssueUrl;
    if (nextUrl !== current.githubIssueUrl) {
      diff.githubIssueUrlChanged = true;
      diff.githubIssueUrlChangedTo = nextUrl;
    }
  }

  if (changes.note !== undefined) {
    const trimmed = changes.note.trim();
    if (trimmed.length > 0) {
      diff.noteText = trimmed;
    }
  }

  const isStateMutating =
    diff.status !== undefined ||
    diff.needsResponse !== undefined ||
    diff.githubIssueUrlChanged;

  const hasAnyChange =
    isStateMutating || diff.noteText !== undefined;

  if (!hasAnyChange) {
    return { ok: false, code: "NO_CHANGES" };
  }

  return {
    status: diff.status,
    noteText: diff.noteText,
    needsResponse: diff.needsResponse,
    githubIssueUrlChanged: diff.githubIssueUrlChanged,
    githubIssueUrlChangedTo: diff.githubIssueUrlChangedTo,
    isStateMutating,
  };
}

async function ensureTriageProjectionLocked(
  tx: Prisma.TransactionClient,
  feedbackId: string,
  operation: FeedbackTriageLockOperation,
): Promise<LockedTriageRow | null> {
  await runFeedbackTriageBeforeLockHook({ feedbackId, operation });

  const locked = await tx.$queryRaw<LockedTriageRow[]>`
    SELECT
      "feedbackId",
      "status",
      "needsResponse",
      "githubIssueUrl",
      "stateRevision",
      "lastEventAt",
      "lastStateChangeAt",
      "lastStateChangeActorEmail",
      "lastStateChangeActorDisplayName"
    FROM "FeedbackTriage"
    WHERE "feedbackId" = ${feedbackId}
    FOR UPDATE
  `;

  if (locked.length > 0) {
    await runFeedbackTriageAfterLockHook({ feedbackId, operation });
    return locked[0]!;
  }

  await tx.$executeRaw`
    INSERT INTO "FeedbackTriage" ("feedbackId", "status", "needsResponse", "stateRevision")
    VALUES (${feedbackId}, 'NEW'::"FeedbackTriageStatus", true, 0)
    ON CONFLICT ("feedbackId") DO NOTHING
  `;

  const lockedAfterCreate = await tx.$queryRaw<LockedTriageRow[]>`
    SELECT
      "feedbackId",
      "status",
      "needsResponse",
      "githubIssueUrl",
      "stateRevision",
      "lastEventAt",
      "lastStateChangeAt",
      "lastStateChangeActorEmail",
      "lastStateChangeActorDisplayName"
    FROM "FeedbackTriage"
    WHERE "feedbackId" = ${feedbackId}
    FOR UPDATE
  `;

  await runFeedbackTriageAfterLockHook({ feedbackId, operation });

  return lockedAfterCreate[0] ?? null;
}

/**
 * Record an operator triage action against a feedback item (#176 decision 3).
 */
export async function recordFeedbackTriageEvent(
  feedbackId: string,
  actorUserId: string,
  changes: FeedbackTriageChanges,
  lastSeenStateRevision: number | undefined,
): Promise<RecordTriageEventResult> {
  const operation: FeedbackTriageLockOperation =
    changes.status !== undefined ||
    changes.needsResponse !== undefined ||
    changes.githubIssueUrl !== undefined
      ? "stateChange"
      : "note";

  return prisma.$transaction(async (tx) => {
    const feedbackExists = await tx.feedback.findUnique({
      where: { id: feedbackId },
      select: { id: true },
    });
    if (!feedbackExists) {
      return {
        ok: false,
        code: "VALIDATION",
        message: "Feedback not found",
      };
    }

    const actor = await tx.user.findUnique({
      where: { id: actorUserId },
      select: { email: true, displayName: true },
    });
    if (!actor) {
      return {
        ok: false,
        code: "VALIDATION",
        message: "Actor user not found",
      };
    }

    const current = await ensureTriageProjectionLocked(tx, feedbackId, operation);
    if (!current) {
      throw new Error(
        `Failed to lock FeedbackTriage projection for feedback ${feedbackId}`,
      );
    }

    const diffResult = resolveDiff(current, changes);
    if ("ok" in diffResult && !diffResult.ok) {
      return diffResult;
    }
    const diff = diffResult as ResolvedDiff;

    if (
      diff.isStateMutating &&
      lastSeenStateRevision !== current.stateRevision
    ) {
      return {
        ok: false,
        code: "STALE_CONFLICT",
        conflict: stalePayload(current),
      };
    }

    const now = new Date();
    const eventData: Prisma.FeedbackTriageEventCreateInput = {
      feedback: { connect: { id: feedbackId } },
      actor: { connect: { id: actorUserId } },
      actorEmail: actor.email,
      actorDisplayName: actor.displayName,
      createdAt: now,
      githubIssueUrlChanged: diff.githubIssueUrlChanged,
    };

    if (diff.status !== undefined) {
      eventData.statusChangedTo = diff.status;
    }
    if (diff.noteText !== undefined) {
      eventData.noteText = diff.noteText;
    }
    if (diff.needsResponse !== undefined) {
      eventData.needsResponseChangedTo = diff.needsResponse;
    }
    if (diff.githubIssueUrlChanged) {
      eventData.githubIssueUrlChangedTo = diff.githubIssueUrlChangedTo ?? null;
    }

    await tx.feedbackTriageEvent.create({ data: eventData });

    const updateData: Prisma.FeedbackTriageUpdateInput = {
      lastEventAt: now,
    };

    if (diff.status !== undefined) {
      updateData.status = diff.status;
    }
    if (diff.needsResponse !== undefined) {
      updateData.needsResponse = diff.needsResponse;
    }
    if (diff.githubIssueUrlChanged) {
      updateData.githubIssueUrl = diff.githubIssueUrlChangedTo ?? null;
    }

    if (diff.isStateMutating) {
      updateData.stateRevision = current.stateRevision + 1;
      updateData.lastStateChangeAt = now;
      updateData.lastStateChangeActorEmail = actor.email;
      updateData.lastStateChangeActorDisplayName = actor.displayName;
    }

    const updated = await tx.feedbackTriage.update({
      where: { feedbackId },
      data: updateData,
    });

    return { ok: true, projection: toProjection(updated) };
  });
}

/** Exported for unit tests that exercise diff/validation without DB. */
export function resolveTriageDiffForTest(
  current: FeedbackTriageProjection,
  changes: FeedbackTriageChanges,
): RecordTriageEventResult | ResolvedDiff {
  return resolveDiff(current, changes);
}

/**
 * Beta participant backfill — pure planning core (#174 PR 1b).
 *
 * Groups legacy BetaInvitation rows (participantId IS NULL) by normalized email,
 * merges compatible history onto one participant, and splits genuinely ambiguous
 * email histories when accepted rows resolve to more than one distinct userId.
 *
 * Database execution lives in `./betaParticipantBackfillDb`.
 */

export type BackfillInvitationSnapshot = {
  id: string;
  participantId: string | null;
  acceptedAt: Date | null;
  acceptedByUserId: string | null;
};

export type BackfillParticipantTarget =
  | {
      kind: "existing";
      participantId: string;
      userId: string | null;
      identityAmbiguous: boolean;
    }
  | {
      kind: "create";
      slotKey: string;
      userId: string | null;
      identityAmbiguous: boolean;
    };

export type BackfillEmailPlan = {
  email: string;
  /** Invitations that still need participantId written. */
  assignments: Array<{
    invitationId: string;
    target: BackfillParticipantTarget;
  }>;
  /** Existing participant pairs that must be merged after assignments. */
  mergeParticipantIds: Array<{ survivorId: string; mergedAwayId: string }>;
  /** Participants whose identityAmbiguous flag must be set true. */
  markAmbiguousParticipantIds: string[];
};

export type BackfillEmailPlanSummary = {
  email: string;
  nullInvitationCount: number;
  assignmentCount: number;
  createCount: number;
  mergeCount: number;
  ambiguousCount: number;
};

const AMBIGUOUS_SLOT_KEY = "__ambiguous__";

function distinctAcceptedUserIds(
  invitations: BackfillInvitationSnapshot[],
): string[] {
  const ids = new Set<string>();
  for (const invitation of invitations) {
    if (invitation.acceptedAt && invitation.acceptedByUserId) {
      ids.add(invitation.acceptedByUserId);
    }
  }
  return [...ids];
}

function pickOldestParticipantId(
  participantIds: Iterable<string>,
): string | null {
  const sorted = [...participantIds].sort();
  return sorted[0] ?? null;
}

/**
 * Plan participant assignment for one normalized-email invitation group.
 * Pure function — no database access.
 */
export function planBackfillForEmailGroup(
  email: string,
  invitations: BackfillInvitationSnapshot[],
): BackfillEmailPlan | null {
  const nullInvitations = invitations.filter((row) => !row.participantId);
  if (nullInvitations.length === 0) {
    return null;
  }

  const acceptedUserIds = distinctAcceptedUserIds(invitations);
  const existingByUserId = new Map<string, string>();
  for (const invitation of invitations) {
    if (
      invitation.participantId &&
      invitation.acceptedAt &&
      invitation.acceptedByUserId
    ) {
      const current = existingByUserId.get(invitation.acceptedByUserId);
      if (!current) {
        existingByUserId.set(
          invitation.acceptedByUserId,
          invitation.participantId,
        );
      }
    }
  }

  const existingParticipantIds = new Set(
    invitations
      .map((row) => row.participantId)
      .filter((id): id is string => id !== null),
  );

  const assignments: BackfillEmailPlan["assignments"] = [];
  const mergeParticipantIds: BackfillEmailPlan["mergeParticipantIds"] = [];
  const markAmbiguousParticipantIds: BackfillEmailPlan["markAmbiguousParticipantIds"] =
    [];

  if (acceptedUserIds.length >= 2) {
    const userSpecificExisting = new Set(existingByUserId.values());
    const ambiguousExistingCandidates = [...existingParticipantIds].filter(
      (participantId) => !userSpecificExisting.has(participantId),
    );
    const ambiguousExistingId = pickOldestParticipantId(
      ambiguousExistingCandidates,
    );

    for (const invitation of nullInvitations) {
      if (
        invitation.acceptedAt &&
        invitation.acceptedByUserId &&
        acceptedUserIds.includes(invitation.acceptedByUserId)
      ) {
        const userId = invitation.acceptedByUserId;
        const existingId = existingByUserId.get(userId);
        assignments.push({
          invitationId: invitation.id,
          target: existingId
            ? {
                kind: "existing",
                participantId: existingId,
                userId,
                identityAmbiguous: false,
              }
            : {
                kind: "create",
                slotKey: `user:${userId}`,
                userId,
                identityAmbiguous: false,
              },
        });
      } else if (ambiguousExistingId) {
        assignments.push({
          invitationId: invitation.id,
          target: {
            kind: "existing",
            participantId: ambiguousExistingId,
            userId: null,
            identityAmbiguous: true,
          },
        });
      } else {
        assignments.push({
          invitationId: invitation.id,
          target: {
            kind: "create",
            slotKey: AMBIGUOUS_SLOT_KEY,
            userId: null,
            identityAmbiguous: true,
          },
        });
      }
    }

    for (const participantId of ambiguousExistingCandidates) {
      markAmbiguousParticipantIds.push(participantId);
    }
  } else if (acceptedUserIds.length === 1) {
    const userId = acceptedUserIds[0];
    const survivorId =
      existingByUserId.get(userId) ??
      pickOldestParticipantId(existingParticipantIds);

    const target: BackfillParticipantTarget = survivorId
      ? {
          kind: "existing",
          participantId: survivorId,
          userId,
          identityAmbiguous: false,
        }
      : {
          kind: "create",
          slotKey: "single",
          userId,
          identityAmbiguous: false,
        };

    for (const invitation of nullInvitations) {
      assignments.push({ invitationId: invitation.id, target });
    }

    for (const participantId of existingParticipantIds) {
      if (survivorId && participantId !== survivorId) {
        mergeParticipantIds.push({ survivorId, mergedAwayId: participantId });
      }
    }
  } else {
    const survivorId = pickOldestParticipantId(existingParticipantIds);
    const target: BackfillParticipantTarget = survivorId
      ? {
          kind: "existing",
          participantId: survivorId,
          userId: null,
          identityAmbiguous: false,
        }
      : {
          kind: "create",
          slotKey: "single",
          userId: null,
          identityAmbiguous: false,
        };

    for (const invitation of nullInvitations) {
      assignments.push({ invitationId: invitation.id, target });
    }

    for (const participantId of existingParticipantIds) {
      if (survivorId && participantId !== survivorId) {
        mergeParticipantIds.push({ survivorId, mergedAwayId: participantId });
      }
    }
  }

  return {
    email,
    assignments,
    mergeParticipantIds,
    markAmbiguousParticipantIds,
  };
}

export function summarizeBackfillEmailPlan(
  plan: BackfillEmailPlan,
  nullInvitationCount: number,
): BackfillEmailPlanSummary {
  const createKeys = new Set<string>();
  for (const assignment of plan.assignments) {
    if (assignment.target.kind === "create") {
      createKeys.add(assignment.target.slotKey);
    }
  }

  return {
    email: plan.email,
    nullInvitationCount,
    assignmentCount: plan.assignments.length,
    createCount: createKeys.size,
    mergeCount: plan.mergeParticipantIds.length,
    ambiguousCount:
      plan.markAmbiguousParticipantIds.length +
      [...createKeys].filter((key) => key === AMBIGUOUS_SLOT_KEY).length,
  };
}

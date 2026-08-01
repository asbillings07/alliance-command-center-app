import type { AccessRequestTriageStatus } from "@/app/generated/prisma/enums";

/**
 * Client-safe subset of AccessRequestTriageProjection needed by the
 * stale-conflict / conversion-blocked recovery UI (#177). Deliberately its
 * own type (mirroring feedback/staleConflict.ts's StaleConflictPayload)
 * rather than importing the full server projection type — the panel only
 * ever needs to display and re-baseline on these fields.
 */
export type AccessRequestConflictPayload = {
  status: AccessRequestTriageStatus;
  betaWave: string | null;
  currentReason: string | null;
  stateRevision: number;
  conflictUserEmail: string | null;
  conflictUserDisplayName: string | null;
  conflictAllianceName: string | null;
  conflictMembershipCount: number | null;
  lastStateChangeAt: Date | null;
  lastStateChangeActorEmail: string | null;
  lastStateChangeActorDisplayName: string | null;
};

export type AccessRequestBaseline = Pick<
  AccessRequestConflictPayload,
  "status" | "betaWave" | "currentReason" | "stateRevision"
>;

/** Applies authoritative conflict state as the new edit baseline. */
export function applyConflictBaseline(
  payload: AccessRequestConflictPayload,
): AccessRequestBaseline {
  return {
    status: payload.status,
    betaWave: payload.betaWave,
    currentReason: payload.currentReason,
    stateRevision: payload.stateRevision,
  };
}

export function formatConflictTimestamp(value: Date | string | null): string {
  if (!value) return "Unknown time";
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

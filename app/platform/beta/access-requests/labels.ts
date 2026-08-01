import type {
  AccessRequestTriageEventType,
  AccessRequestTriageStatus,
  InvitationConflictType,
} from "@/app/generated/prisma/enums";
import type { BadgeVariant } from "@/app/src/components";
import type { AccessRequestTriageHistoryItem } from "@/app/src/lib/platform/accessRequestInbox";

export const ALL_ACCESS_REQUEST_STATUSES: AccessRequestTriageStatus[] = [
  "PENDING",
  "INVITED",
  "DECLINED",
  "RESOLVED_EXISTING_ACCESS",
];

export const ACCESS_REQUEST_STATUS_LABELS: Record<AccessRequestTriageStatus, string> = {
  PENDING: "Pending",
  INVITED: "Invited",
  DECLINED: "Declined",
  RESOLVED_EXISTING_ACCESS: "Resolved — already has access",
};

export const ACCESS_REQUEST_STATUS_VARIANTS: Record<AccessRequestTriageStatus, BadgeVariant> = {
  PENDING: "warning",
  INVITED: "success",
  DECLINED: "danger",
  RESOLVED_EXISTING_ACCESS: "info",
};

export const EVENT_TYPE_LABELS: Record<AccessRequestTriageEventType, string> = {
  NOTE_ADDED: "Note added",
  CONVERSION_BLOCKED: "Approval blocked",
  INVITED: "Invited",
  DECLINED: "Declined",
  REOPENED: "Reopened",
  RESOLVED_EXISTING_ACCESS: "Resolved — already has access",
};

export const CONFLICT_TYPE_LABELS: Record<InvitationConflictType, string> = {
  NONE: "No conflict",
  ACTIVE_PENDING_INVITATION: "Active pending invitation",
  EXISTING_ALLIANCE_ACCESS: "Already has alliance access",
  IDENTITY_AMBIGUOUS: "Identity is ambiguous",
  ALREADY_ACCEPTED: "Already accepted a beta invitation",
  EXISTING_PARTICIPANT_REISSUE: "Already a beta participant",
};

/**
 * Operator-facing guidance for each non-NONE conflict type (#177 design
 * decision 2/3). Mirrors describeInvitationConflict (invitationConflict.ts)
 * but written for the pre-approval panel rather than an event/error message
 * — e.g. it points at where the recommended action lives (the Beta page)
 * rather than assuming the reader already knows the domain vocabulary.
 */
export const CONFLICT_TYPE_GUIDANCE: Record<Exclude<InvitationConflictType, "NONE">, string> = {
  ACTIVE_PENDING_INVITATION:
    "This person already has an active invitation. Resend it from the Beta page instead of approving a new one.",
  EXISTING_ALLIANCE_ACCESS:
    "This person already has access to an alliance. No invitation is needed — resolve this request instead.",
  IDENTITY_AMBIGUOUS:
    "This person's identity is ambiguous across existing beta records. Keep this request pending and investigate manually before approving.",
  ALREADY_ACCEPTED: "This person has already accepted a beta invitation.",
  EXISTING_PARTICIPANT_REISSUE:
    "This person is already a beta participant. Use Reissue on their latest attempt from the Beta page instead of approving a new invitation.",
};

export function formatActorLabel(email: string, displayName: string | null): string {
  return displayName ? `${displayName} (${email})` : email;
}

/** One-line summary for a history event — used by both the compact and full history views. */
export function formatHistoryEventSummary(event: AccessRequestTriageHistoryItem): string {
  switch (event.eventType) {
    case "NOTE_ADDED":
      return "Note added";
    case "DECLINED":
      return "Declined";
    case "RESOLVED_EXISTING_ACCESS":
      return "Resolved — already has access";
    case "REOPENED":
      return "Reopened";
    case "INVITED":
      return "Invited";
    case "CONVERSION_BLOCKED":
      return "Approval blocked";
  }
}

/** Detail lines shown under the summary — the reason text and any conflict evidence snapshot. */
export function formatHistoryEventDetails(event: AccessRequestTriageHistoryItem): string[] {
  const lines: string[] = [];

  switch (event.eventType) {
    case "NOTE_ADDED":
      if (event.noteText) lines.push(event.noteText);
      break;
    case "DECLINED":
      if (event.declineReason) lines.push(event.declineReason);
      break;
    case "RESOLVED_EXISTING_ACCESS":
      if (event.resolutionReason) lines.push(event.resolutionReason);
      break;
    case "REOPENED":
      if (event.reopenReason) lines.push(event.reopenReason);
      break;
    case "INVITED":
      if (event.betaWave) lines.push(`Beta wave: ${event.betaWave}`);
      break;
    case "CONVERSION_BLOCKED":
      if (event.blockedReason) lines.push(event.blockedReason);
      break;
  }

  if (event.conflictAllianceName) {
    lines.push(
      `Alliance: ${event.conflictAllianceName}${
        event.conflictMembershipCount ? ` (${event.conflictMembershipCount} membership${event.conflictMembershipCount === 1 ? "" : "s"})` : ""
      }`,
    );
  }
  if (event.conflictUserEmail) {
    lines.push(
      `User: ${formatActorLabel(event.conflictUserEmail, event.conflictUserDisplayName)}`,
    );
  }
  if (event.blockedConflictType) {
    lines.push(`Conflict: ${CONFLICT_TYPE_LABELS[event.blockedConflictType]}`);
  }

  return lines;
}

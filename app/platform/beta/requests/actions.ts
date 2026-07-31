"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/app/src/lib/auth/requirePlatformAdmin";
import {
  addAccessRequestNote,
  declineAccessRequest,
  resolveExistingAccess,
  reopenAccessRequest,
  convertAccessRequestToInvitation,
  type AccessRequestTriageActionResult,
  type AccessRequestTriageProjection,
} from "@/app/src/lib/accessRequestTriage";
import { DeliveryActorUnavailableError } from "@/app/src/lib/betaInvitationDelivery";
import { deliverBetaInvitationEmail } from "@/app/src/lib/betaInvitation";
import {
  listAccessRequestsForTriage,
  listAccessRequestTriageHistory,
  listBetaWaveOptions,
  checkAccessRequestConflict,
  type AccessRequestInboxFilters,
  type AccessRequestInboxListItem,
  type AccessRequestInboxStatusCounts,
  type AccessRequestTriageHistoryItem,
  type BetaWaveOption,
} from "@/app/src/lib/platform/accessRequestInbox";
import type { InvitationConflictResolution } from "@/app/src/lib/invitationConflict";
import { emailService } from "@/app/src/lib/email";
import type { EmailStatus } from "@/app/src/lib/email";

const ACCESS_REQUESTS_PATH = "/platform/beta/requests";

const STALE_CONFLICT_MESSAGE =
  "Someone else updated this request while you were working on it. Review the current state below, then try again if you still want to make this change.";

/**
 * Server actions for the platform beta access-request queue (#177).
 *
 * Every action starts with requirePlatformAdmin() (ADR-006/ADR-010). Every
 * mutating action maps the domain service's typed result codes onto a
 * plain success/error shape for client components, mirroring
 * recordFeedbackTriageEventAction's stale-conflict handling
 * (app/platform/feedback/actions.ts).
 */

export type AccessRequestActionResult =
  | { success: true; projection: AccessRequestTriageProjection }
  | { success: false; error: string; conflict?: AccessRequestTriageProjection };

function mapActionResult(result: AccessRequestTriageActionResult): AccessRequestActionResult {
  if (result.ok) {
    return { success: true, projection: result.projection };
  }
  switch (result.code) {
    case "NOT_FOUND":
      return { success: false, error: "Access request not found" };
    case "VALIDATION":
      return { success: false, error: result.message };
    case "STALE_CONFLICT":
      return { success: false, error: STALE_CONFLICT_MESSAGE, conflict: result.conflict };
    case "REOPEN_DENIED_ACCESS_STILL_EXISTS":
      return { success: false, error: result.message, conflict: result.projection };
  }
}

export type AccessRequestInboxResult =
  | {
      success: true;
      items: AccessRequestInboxListItem[];
      total: number;
      page: number;
      pageSize: number;
      statusCounts: AccessRequestInboxStatusCounts;
    }
  | { success: false; error: string };

/**
 * Load the paginated, filterable access-request queue.
 */
export async function fetchAccessRequestInboxAction(
  filters: AccessRequestInboxFilters,
  page = 1,
  pageSize = 20,
): Promise<AccessRequestInboxResult> {
  await requirePlatformAdmin();

  try {
    const result = await listAccessRequestsForTriage(filters, page, pageSize);
    return {
      success: true,
      items: result.items,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      statusCounts: result.statusCounts,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to load access requests",
    };
  }
}

export type AccessRequestHistoryResult =
  | { success: true; items: AccessRequestTriageHistoryItem[]; total: number; page: number; pageSize: number }
  | { success: false; error: string };

/**
 * Load paginated decision-history events for one access request. Called
 * with pageSize=5 for the compact "5 newest events" view and with a larger
 * page/pageSize for "View full history" — same read model, same ordering.
 */
export async function fetchAccessRequestHistoryAction(
  accessRequestId: string,
  page = 1,
  pageSize = 5,
): Promise<AccessRequestHistoryResult> {
  await requirePlatformAdmin();

  if (!accessRequestId) {
    return { success: false, error: "Access request not found" };
  }

  try {
    const result = await listAccessRequestTriageHistory(accessRequestId, page, pageSize);
    return {
      success: true,
      items: result.items,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to load history",
    };
  }
}

export type BetaWaveOptionsResult =
  | { success: true; waves: BetaWaveOption[] }
  | { success: false; error: string };

/**
 * Load the bounded, distinct list of existing beta-wave values for the
 * approve-and-invite combobox (#177 design decision 3).
 */
export async function fetchBetaWaveOptionsAction(): Promise<BetaWaveOptionsResult> {
  await requirePlatformAdmin();

  try {
    const waves = await listBetaWaveOptions();
    return { success: true, waves };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to load beta waves",
    };
  }
}

export type AccessRequestConflictCheckActionResult =
  | { success: true; resolution: InvitationConflictResolution }
  | { success: false; error: string };

/**
 * On-demand conflict pre-check for one access request, so the operator sees
 * "here's what we found" (Open existing participant / Resend / Reissue /
 * Resolve — already has access) BEFORE clicking Approve. Never batched
 * across the list (#177 design decision) and never a substitute for the
 * authoritative re-check inside convertAccessRequestToInvitation.
 */
export async function checkAccessRequestConflictAction(
  accessRequestId: string,
): Promise<AccessRequestConflictCheckActionResult> {
  await requirePlatformAdmin();

  if (!accessRequestId) {
    return { success: false, error: "Access request not found" };
  }

  const result = await checkAccessRequestConflict(accessRequestId);
  if (!result.ok) {
    return { success: false, error: "Access request not found" };
  }
  return { success: true, resolution: result.resolution };
}

/**
 * Add an internal operator note. Does not change status.
 */
export async function addAccessRequestNoteAction(
  accessRequestId: string,
  note: string,
): Promise<AccessRequestActionResult> {
  const session = await requirePlatformAdmin();
  const result = await addAccessRequestNote(accessRequestId, session.id, note);
  if (result.ok) {
    revalidatePath(ACCESS_REQUESTS_PATH);
  }
  return mapActionResult(result);
}

/**
 * Decline a pending access request. Reversible only via reopenAccessRequestAction.
 */
export async function declineAccessRequestAction(
  accessRequestId: string,
  reason: string,
  lastSeenStateRevision: number,
): Promise<AccessRequestActionResult> {
  const session = await requirePlatformAdmin();
  const result = await declineAccessRequest(accessRequestId, session.id, reason, lastSeenStateRevision);
  if (result.ok) {
    revalidatePath(ACCESS_REQUESTS_PATH);
  }
  return mapActionResult(result);
}

/**
 * Resolve a request as "already has access" — creates no invitation, sends
 * no email (#177 design decision 2).
 */
export async function resolveExistingAccessAction(
  accessRequestId: string,
  reason: string,
  lastSeenStateRevision: number,
): Promise<AccessRequestActionResult> {
  const session = await requirePlatformAdmin();
  const result = await resolveExistingAccess(accessRequestId, session.id, reason, lastSeenStateRevision);
  if (result.ok) {
    revalidatePath(ACCESS_REQUESTS_PATH);
  }
  return mapActionResult(result);
}

/**
 * Reopen a DECLINED or RESOLVED_EXISTING_ACCESS request back to PENDING.
 * DECLINED always succeeds with a reason; RESOLVED_EXISTING_ACCESS re-derives
 * access and only succeeds if access is genuinely gone (REOPEN_DENIED_ACCESS_STILL_EXISTS
 * otherwise). INVITED is irreversible — use resend/reissue instead.
 */
export async function reopenAccessRequestAction(
  accessRequestId: string,
  reason: string,
  lastSeenStateRevision: number,
): Promise<AccessRequestActionResult> {
  const session = await requirePlatformAdmin();
  const result = await reopenAccessRequest(accessRequestId, session.id, reason, lastSeenStateRevision);
  if (result.ok) {
    revalidatePath(ACCESS_REQUESTS_PATH);
  }
  return mapActionResult(result);
}

/**
 * Honest, four-way email-delivery outcome for convertAccessRequestAction
 * (ADR-014, "Access request conversion delivery (#177)"). The invitation and
 * projection are ALREADY COMMITTED by the time any of these are decided —
 * every branch below reports success:true, since provider/actor failures
 * never erase the approval/conversion record.
 */
export type DeliveryDisposition =
  | { type: "ATTEMPTED"; status: EmailStatus }
  | { type: "NOT_RETRIED_IDEMPOTENT" }
  | { type: "NOT_ATTEMPTED"; reason: "ACTOR_UNAVAILABLE" }
  | { type: "UNKNOWN"; message: string };

export type ConvertAccessRequestActionResult =
  | {
      success: true;
      inviteCode: string;
      inviteUrl: string;
      email: string;
      disposition: DeliveryDisposition;
      projection: AccessRequestTriageProjection;
    }
  | { success: false; error: string; conflict?: AccessRequestTriageProjection };

/**
 * Approve a pending access request and convert it into a BetaInvitation.
 *
 * Persistence (invitation + triage + INVITED event) is atomic and already
 * committed by convertAccessRequestToInvitation (PR 1). This action's only
 * job is the part PR 1 deliberately deferred: deciding whether to (re)attempt
 * delivery, and honestly reporting what happened — never inferring that
 * "not recorded" means "not sent" (ADR-014).
 */
export async function convertAccessRequestAction(
  accessRequestId: string,
  betaWave: string,
  lastSeenStateRevision: number,
): Promise<ConvertAccessRequestActionResult> {
  const session = await requirePlatformAdmin();

  const result = await convertAccessRequestToInvitation(
    accessRequestId,
    session.id,
    betaWave,
    lastSeenStateRevision,
  );

  if (!result.ok) {
    switch (result.code) {
      case "NOT_FOUND":
        return { success: false, error: "Access request not found" };
      case "VALIDATION":
        return { success: false, error: result.message };
      case "STALE_CONFLICT":
        return { success: false, error: STALE_CONFLICT_MESSAGE, conflict: result.conflict };
      case "CONVERSION_BLOCKED":
        return { success: false, error: result.message, conflict: result.projection };
    }
  }

  revalidatePath(ACCESS_REQUESTS_PATH);
  revalidatePath("/platform/beta");

  const base = {
    success: true as const,
    inviteCode: result.inviteCode,
    inviteUrl: result.inviteUrl,
    email: result.invitation.email,
    projection: result.projection,
  };

  if (!result.shouldDeliver) {
    // Idempotent re-conversion (retry/double-click/race on an
    // already-INVITED request): this call did not (re)trigger delivery.
    // That does NOT mean delivery never happened — see ADR-014.
    return { ...base, disposition: { type: "NOT_RETRIED_IDEMPOTENT" } };
  }

  try {
    const status = await deliverBetaInvitationEmail(
      result.invitation,
      result.inviteUrl,
      (input) => emailService.sendBetaInvitation(input),
      session.id,
    );
    return { ...base, disposition: { type: "ATTEMPTED", status } };
  } catch (error) {
    if (error instanceof DeliveryActorUnavailableError) {
      // Pre-transport, deterministic: we know with certainty transport never ran.
      return { ...base, disposition: { type: "NOT_ATTEMPTED", reason: "ACTOR_UNAVAILABLE" } };
    }
    // Post-commit, non-deterministic: the invitation is durable history, but
    // it is genuinely unknown whether transport ran. Never silently retry or
    // silently do nothing — surface it and point at the existing Resend action.
    return {
      ...base,
      disposition: {
        type: "UNKNOWN",
        message: "Conversion succeeded; delivery status is unknown. Use Resend to retry sending the email.",
      },
    };
  }
}

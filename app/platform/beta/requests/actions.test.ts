import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRequirePlatformAdmin = vi.fn();
const mockAddAccessRequestNote = vi.fn();
const mockDeclineAccessRequest = vi.fn();
const mockResolveExistingAccess = vi.fn();
const mockReopenAccessRequest = vi.fn();
const mockConvertAccessRequestToInvitation = vi.fn();
const mockDeliverBetaInvitationEmail = vi.fn();
const mockSendBetaInvitation = vi.fn();
const mockRevalidatePath = vi.fn();
const mockListAccessRequestsForTriage = vi.fn();
const mockListAccessRequestTriageHistory = vi.fn();
const mockListBetaWaveOptions = vi.fn();
const mockCheckAccessRequestConflict = vi.fn();

vi.mock("@/app/src/lib/auth/requirePlatformAdmin", () => ({
  requirePlatformAdmin: () => mockRequirePlatformAdmin(),
}));

vi.mock("@/app/src/lib/accessRequestTriage", () => ({
  addAccessRequestNote: (...args: unknown[]) => mockAddAccessRequestNote(...args),
  declineAccessRequest: (...args: unknown[]) => mockDeclineAccessRequest(...args),
  resolveExistingAccess: (...args: unknown[]) => mockResolveExistingAccess(...args),
  reopenAccessRequest: (...args: unknown[]) => mockReopenAccessRequest(...args),
  convertAccessRequestToInvitation: (...args: unknown[]) =>
    mockConvertAccessRequestToInvitation(...args),
}));

// Real class import (not mocked) so `instanceof DeliveryActorUnavailableError`
// in actions.ts matches errors thrown by this test.
vi.mock("@/app/src/lib/betaInvitation", async () => {
  const actual = await vi.importActual<typeof import("@/app/src/lib/betaInvitation")>(
    "@/app/src/lib/betaInvitation",
  );
  return {
    ...actual,
    deliverBetaInvitationEmail: (...args: unknown[]) => mockDeliverBetaInvitationEmail(...args),
  };
});

vi.mock("@/app/src/lib/platform/accessRequestInbox", () => ({
  listAccessRequestsForTriage: (...args: unknown[]) => mockListAccessRequestsForTriage(...args),
  listAccessRequestTriageHistory: (...args: unknown[]) => mockListAccessRequestTriageHistory(...args),
  listBetaWaveOptions: (...args: unknown[]) => mockListBetaWaveOptions(...args),
  checkAccessRequestConflict: (...args: unknown[]) => mockCheckAccessRequestConflict(...args),
}));

vi.mock("@/app/src/lib/email", () => ({
  emailService: {
    sendBetaInvitation: (...args: unknown[]) => mockSendBetaInvitation(...args),
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

import {
  fetchAccessRequestInboxAction,
  fetchAccessRequestHistoryAction,
  fetchBetaWaveOptionsAction,
  checkAccessRequestConflictAction,
  addAccessRequestNoteAction,
  declineAccessRequestAction,
  resolveExistingAccessAction,
  reopenAccessRequestAction,
  convertAccessRequestAction,
} from "./actions";
import { DeliveryActorUnavailableError } from "@/app/src/lib/betaInvitationDelivery";
import type { AccessRequestTriageProjection } from "@/app/src/lib/accessRequestTriage";

function makeProjection(
  overrides: Partial<AccessRequestTriageProjection> = {},
): AccessRequestTriageProjection {
  return {
    accessRequestId: "req-1",
    status: "PENDING",
    linkedInvitationId: null,
    betaWave: null,
    conflictUserId: null,
    conflictUserIdSnapshot: null,
    conflictUserEmail: null,
    conflictUserDisplayName: null,
    conflictAllianceId: null,
    conflictAllianceIdSnapshot: null,
    conflictAllianceName: null,
    conflictMembershipCount: null,
    currentReason: null,
    stateRevision: 0,
    lastEventAt: null,
    lastEventActorEmail: null,
    lastEventActorDisplayName: null,
    lastStateChangeAt: null,
    lastStateChangeActorEmail: null,
    lastStateChangeActorDisplayName: null,
    ...overrides,
  };
}

describe("platform beta access-request actions (#177)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequirePlatformAdmin.mockResolvedValue({ id: "operator-1", email: "operator@example.test" });
  });

  describe("authorization gating", () => {
    it.each([
      ["fetchAccessRequestInboxAction", () => fetchAccessRequestInboxAction({}, 1, 20)],
      ["fetchAccessRequestHistoryAction", () => fetchAccessRequestHistoryAction("req-1")],
      ["fetchBetaWaveOptionsAction", () => fetchBetaWaveOptionsAction()],
      ["checkAccessRequestConflictAction", () => checkAccessRequestConflictAction("req-1")],
      ["addAccessRequestNoteAction", () => addAccessRequestNoteAction("req-1", "note")],
      ["declineAccessRequestAction", () => declineAccessRequestAction("req-1", "reason", 0)],
      ["resolveExistingAccessAction", () => resolveExistingAccessAction("req-1", "reason", 0)],
      ["reopenAccessRequestAction", () => reopenAccessRequestAction("req-1", "reason", 0)],
      ["convertAccessRequestAction", () => convertAccessRequestAction("req-1", "Wave 1", 0)],
    ])("%s requires platform admin before touching any domain service", async (_name, invoke) => {
      mockRequirePlatformAdmin.mockRejectedValue(new Error("NEXT_REDIRECT"));

      await expect(invoke()).rejects.toThrow("NEXT_REDIRECT");

      expect(mockAddAccessRequestNote).not.toHaveBeenCalled();
      expect(mockDeclineAccessRequest).not.toHaveBeenCalled();
      expect(mockResolveExistingAccess).not.toHaveBeenCalled();
      expect(mockReopenAccessRequest).not.toHaveBeenCalled();
      expect(mockConvertAccessRequestToInvitation).not.toHaveBeenCalled();
      expect(mockListAccessRequestsForTriage).not.toHaveBeenCalled();
      expect(mockListAccessRequestTriageHistory).not.toHaveBeenCalled();
      expect(mockListBetaWaveOptions).not.toHaveBeenCalled();
      expect(mockCheckAccessRequestConflict).not.toHaveBeenCalled();
    });
  });

  describe("fetchAccessRequestInboxAction", () => {
    it("returns the read model result on success", async () => {
      mockListAccessRequestsForTriage.mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
        statusCounts: { PENDING: 0, INVITED: 0, DECLINED: 0, RESOLVED_EXISTING_ACCESS: 0 },
      });

      const result = await fetchAccessRequestInboxAction({ status: "PENDING" }, 1, 20);

      expect(result).toEqual({
        success: true,
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
        statusCounts: { PENDING: 0, INVITED: 0, DECLINED: 0, RESOLVED_EXISTING_ACCESS: 0 },
      });
      expect(mockListAccessRequestsForTriage).toHaveBeenCalledWith({ status: "PENDING" }, 1, 20);
    });

    it("returns an error result when the read model throws", async () => {
      mockListAccessRequestsForTriage.mockRejectedValue(new Error("db exploded"));

      const result = await fetchAccessRequestInboxAction({}, 1, 20);

      expect(result).toEqual({ success: false, error: "db exploded" });
    });
  });

  describe("fetchAccessRequestHistoryAction", () => {
    it("returns an error without querying for an empty accessRequestId", async () => {
      const result = await fetchAccessRequestHistoryAction("");
      expect(result).toEqual({ success: false, error: "Access request not found" });
      expect(mockListAccessRequestTriageHistory).not.toHaveBeenCalled();
    });

    it("returns paginated history on success", async () => {
      mockListAccessRequestTriageHistory.mockResolvedValue({
        items: [{ id: "evt-1" }],
        total: 1,
        page: 1,
        pageSize: 5,
      });

      const result = await fetchAccessRequestHistoryAction("req-1", 1, 5);

      expect(result).toEqual({
        success: true,
        items: [{ id: "evt-1" }],
        total: 1,
        page: 1,
        pageSize: 5,
      });
      expect(mockListAccessRequestTriageHistory).toHaveBeenCalledWith("req-1", 1, 5);
    });
  });

  describe("fetchBetaWaveOptionsAction", () => {
    it("returns wave options on success", async () => {
      mockListBetaWaveOptions.mockResolvedValue([{ id: "Wave 1", name: "Wave 1" }]);

      const result = await fetchBetaWaveOptionsAction();

      expect(result).toEqual({ success: true, waves: [{ id: "Wave 1", name: "Wave 1" }] });
    });
  });

  describe("checkAccessRequestConflictAction", () => {
    it("returns an error without querying for an empty accessRequestId", async () => {
      const result = await checkAccessRequestConflictAction("");
      expect(result).toEqual({ success: false, error: "Access request not found" });
      expect(mockCheckAccessRequestConflict).not.toHaveBeenCalled();
    });

    it("maps NOT_FOUND from the read model", async () => {
      mockCheckAccessRequestConflict.mockResolvedValue({ ok: false, error: "NOT_FOUND" });

      const result = await checkAccessRequestConflictAction("missing");

      expect(result).toEqual({ success: false, error: "Access request not found" });
    });

    it("returns the resolution on success", async () => {
      const resolution = { primary: { type: "NONE" }, all: [] };
      mockCheckAccessRequestConflict.mockResolvedValue({ ok: true, resolution });

      const result = await checkAccessRequestConflictAction("req-1");

      expect(result).toEqual({ success: true, resolution });
    });
  });

  describe("addAccessRequestNoteAction", () => {
    it("returns success and revalidates on success", async () => {
      const projection = makeProjection();
      mockAddAccessRequestNote.mockResolvedValue({ ok: true, projection });

      const result = await addAccessRequestNoteAction("req-1", "a note");

      expect(result).toEqual({ success: true, projection });
      expect(mockAddAccessRequestNote).toHaveBeenCalledWith("req-1", "operator-1", "a note");
      expect(mockRevalidatePath).toHaveBeenCalledWith("/platform/beta/requests");
    });

    it("maps VALIDATION without revalidating", async () => {
      mockAddAccessRequestNote.mockResolvedValue({
        ok: false,
        code: "VALIDATION",
        message: "Note must not be blank",
      });

      const result = await addAccessRequestNoteAction("req-1", "");

      expect(result).toEqual({ success: false, error: "Note must not be blank" });
      expect(mockRevalidatePath).not.toHaveBeenCalled();
    });

    it("maps NOT_FOUND", async () => {
      mockAddAccessRequestNote.mockResolvedValue({ ok: false, code: "NOT_FOUND" });

      const result = await addAccessRequestNoteAction("missing", "note");

      expect(result).toEqual({ success: false, error: "Access request not found" });
    });
  });

  describe("declineAccessRequestAction", () => {
    it("passes lastSeenStateRevision through and revalidates on success", async () => {
      const projection = makeProjection({ status: "DECLINED", currentReason: "Not a fit" });
      mockDeclineAccessRequest.mockResolvedValue({ ok: true, projection });

      const result = await declineAccessRequestAction("req-1", "Not a fit", 3);

      expect(result).toEqual({ success: true, projection });
      expect(mockDeclineAccessRequest).toHaveBeenCalledWith("req-1", "operator-1", "Not a fit", 3);
      expect(mockRevalidatePath).toHaveBeenCalledWith("/platform/beta/requests");
    });

    it("maps STALE_CONFLICT with the current projection attached", async () => {
      const conflict = makeProjection({ status: "INVITED", stateRevision: 5 });
      mockDeclineAccessRequest.mockResolvedValue({ ok: false, code: "STALE_CONFLICT", conflict });

      const result = await declineAccessRequestAction("req-1", "Not a fit", 0);

      expect(result).toEqual({
        success: false,
        error: expect.stringContaining("Someone else updated this request"),
        conflict,
      });
      expect(mockRevalidatePath).not.toHaveBeenCalled();
    });
  });

  describe("resolveExistingAccessAction", () => {
    it("returns success on resolution", async () => {
      const projection = makeProjection({ status: "RESOLVED_EXISTING_ACCESS" });
      mockResolveExistingAccess.mockResolvedValue({ ok: true, projection });

      const result = await resolveExistingAccessAction("req-1", "already has access", 0);

      expect(result).toEqual({ success: true, projection });
      expect(mockResolveExistingAccess).toHaveBeenCalledWith(
        "req-1",
        "operator-1",
        "already has access",
        0,
      );
    });
  });

  describe("reopenAccessRequestAction", () => {
    it("returns success when reopen succeeds", async () => {
      const projection = makeProjection({ status: "PENDING" });
      mockReopenAccessRequest.mockResolvedValue({ ok: true, projection });

      const result = await reopenAccessRequestAction("req-1", "corrected identity", 2);

      expect(result).toEqual({ success: true, projection });
      expect(mockRevalidatePath).toHaveBeenCalledWith("/platform/beta/requests");
    });

    it("maps REOPEN_DENIED_ACCESS_STILL_EXISTS using the domain message and refreshed projection", async () => {
      const projection = makeProjection({ status: "RESOLVED_EXISTING_ACCESS" });
      mockReopenAccessRequest.mockResolvedValue({
        ok: false,
        code: "REOPEN_DENIED_ACCESS_STILL_EXISTS",
        projection,
        message: "Reopen denied: this identity still shows existing alliance access (Some Alliance).",
      });

      const result = await reopenAccessRequestAction("req-1", "please reopen", 1);

      expect(result).toEqual({
        success: false,
        error: "Reopen denied: this identity still shows existing alliance access (Some Alliance).",
        conflict: projection,
      });
      expect(mockRevalidatePath).not.toHaveBeenCalled();
    });
  });

  describe("convertAccessRequestAction", () => {
    const invitation = {
      id: "inv-1",
      email: "applicant@example.test",
      code: "ABC-DEF",
      token: "tok",
      expiresAt: new Date("2027-01-01"),
    };

    function mockConvertSuccess(overrides: Partial<{ shouldDeliver: boolean }> = {}) {
      const projection = makeProjection({ status: "INVITED", linkedInvitationId: invitation.id });
      mockConvertAccessRequestToInvitation.mockResolvedValue({
        ok: true,
        projection,
        createdNow: true,
        shouldDeliver: overrides.shouldDeliver ?? true,
        invitation,
        inviteUrl: "https://example.com/redeem/tok",
        inviteCode: "ABC-DEF",
      });
      return projection;
    }

    it("passes lastSeenStateRevision and betaWave through to conversion", async () => {
      mockConvertSuccess();
      mockDeliverBetaInvitationEmail.mockResolvedValue("sent");

      await convertAccessRequestAction("req-1", "Wave 3", 4);

      expect(mockConvertAccessRequestToInvitation).toHaveBeenCalledWith(
        "req-1",
        "operator-1",
        "Wave 3",
        4,
      );
    });

    it("attempts delivery and reports ATTEMPTED on a new conversion", async () => {
      const projection = mockConvertSuccess({ shouldDeliver: true });
      mockDeliverBetaInvitationEmail.mockResolvedValue("sent");

      const result = await convertAccessRequestAction("req-1", "Wave 3", 0);

      expect(result).toEqual({
        success: true,
        inviteCode: "ABC-DEF",
        inviteUrl: "https://example.com/redeem/tok",
        email: "applicant@example.test",
        disposition: { type: "ATTEMPTED", status: "sent" },
        projection,
      });
      expect(mockDeliverBetaInvitationEmail).toHaveBeenCalledWith(
        invitation,
        "https://example.com/redeem/tok",
        expect.any(Function),
        "operator-1",
      );
      expect(mockRevalidatePath).toHaveBeenCalledWith("/platform/beta/requests");
      expect(mockRevalidatePath).toHaveBeenCalledWith("/platform/beta");
    });

    it("does not attempt delivery and reports NOT_RETRIED_IDEMPOTENT on an idempotent re-conversion", async () => {
      mockConvertSuccess({ shouldDeliver: false });

      const result = await convertAccessRequestAction("req-1", "Wave 3", 0);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.disposition).toEqual({ type: "NOT_RETRIED_IDEMPOTENT" });
      }
      expect(mockDeliverBetaInvitationEmail).not.toHaveBeenCalled();
    });

    it("reports NOT_ATTEMPTED when the acting user is gone before transport", async () => {
      mockConvertSuccess({ shouldDeliver: true });
      mockDeliverBetaInvitationEmail.mockRejectedValue(
        new DeliveryActorUnavailableError("operator-1"),
      );

      const result = await convertAccessRequestAction("req-1", "Wave 3", 0);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.disposition).toEqual({
          type: "NOT_ATTEMPTED",
          reason: "ACTOR_UNAVAILABLE",
        });
      }
    });

    it("reports UNKNOWN, never NOT_ATTEMPTED, for a post-transport delivery failure", async () => {
      mockConvertSuccess({ shouldDeliver: true });
      mockDeliverBetaInvitationEmail.mockRejectedValue(new Error("provider timeout"));

      const result = await convertAccessRequestAction("req-1", "Wave 3", 0);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.disposition.type).toBe("UNKNOWN");
        if (result.disposition.type === "UNKNOWN") {
          expect(result.disposition.message).toContain("Use Resend");
        }
      }
    });

    it("still reports conversion success even though delivery outcome is unknown (never erases the commit)", async () => {
      const projection = mockConvertSuccess({ shouldDeliver: true });
      mockDeliverBetaInvitationEmail.mockRejectedValue(new Error("provider timeout"));

      const result = await convertAccessRequestAction("req-1", "Wave 3", 0);

      expect(result).toMatchObject({
        success: true,
        inviteCode: "ABC-DEF",
        inviteUrl: "https://example.com/redeem/tok",
        email: "applicant@example.test",
        projection,
      });
    });

    it("maps STALE_CONFLICT without attempting delivery", async () => {
      const conflict = makeProjection({ status: "DECLINED" });
      mockConvertAccessRequestToInvitation.mockResolvedValue({
        ok: false,
        code: "STALE_CONFLICT",
        conflict,
      });

      const result = await convertAccessRequestAction("req-1", "Wave 3", 0);

      expect(result).toEqual({
        success: false,
        error: expect.stringContaining("Someone else updated this request"),
        conflict,
      });
      expect(mockDeliverBetaInvitationEmail).not.toHaveBeenCalled();
      expect(mockRevalidatePath).not.toHaveBeenCalled();
    });

    it("maps CONVERSION_BLOCKED with the blocked projection and message, without attempting delivery", async () => {
      const projection = makeProjection({ status: "PENDING" });
      mockConvertAccessRequestToInvitation.mockResolvedValue({
        ok: false,
        code: "CONVERSION_BLOCKED",
        projection,
        conflictType: "EXISTING_ALLIANCE_ACCESS",
        message: "This identity already has alliance access.",
      });

      const result = await convertAccessRequestAction("req-1", "Wave 3", 0);

      expect(result).toEqual({
        success: false,
        error: "This identity already has alliance access.",
        conflict: projection,
      });
      expect(mockDeliverBetaInvitationEmail).not.toHaveBeenCalled();
    });

    it("maps VALIDATION for an invalid beta wave without attempting delivery", async () => {
      mockConvertAccessRequestToInvitation.mockResolvedValue({
        ok: false,
        code: "VALIDATION",
        message: "Beta wave must not be blank",
      });

      const result = await convertAccessRequestAction("req-1", "", 0);

      expect(result).toEqual({ success: false, error: "Beta wave must not be blank" });
      expect(mockDeliverBetaInvitationEmail).not.toHaveBeenCalled();
    });

    it("maps NOT_FOUND", async () => {
      mockConvertAccessRequestToInvitation.mockResolvedValue({ ok: false, code: "NOT_FOUND" });

      const result = await convertAccessRequestAction("missing", "Wave 1", 0);

      expect(result).toEqual({ success: false, error: "Access request not found" });
    });
  });
});

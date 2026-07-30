import { describe, it, expect } from "vitest";
import {
  BETA_PARTICIPANTS_INPUT_MAX_LENGTH,
  BETA_PARTICIPANTS_MAX_OFFSET,
  BETA_PARTICIPANTS_PAGE_SIZE_MAX,
  BETA_PARTICIPANTS_ATTENTION_STALE_DAYS,
  boundBetaParticipantsInput,
  buildIlikeContainsPattern,
  clampBetaParticipantsPagination,
  deriveJourneyStage,
  deriveLatestAttemptStatus,
  deriveParticipantAttention,
  escapeIlikePattern,
  daysSince,
  mapDeliverySummary,
} from "./betaParticipants";

describe("clampBetaParticipantsPagination", () => {
  it("clamps pageSize to 1-50", () => {
    expect(clampBetaParticipantsPagination(1, 0).pageSize).toBe(1);
    expect(clampBetaParticipantsPagination(1, 100).pageSize).toBe(
      BETA_PARTICIPANTS_PAGE_SIZE_MAX,
    );
    expect(clampBetaParticipantsPagination(1, 25).pageSize).toBe(25);
  });

  it("clamps page to at least 1", () => {
    expect(clampBetaParticipantsPagination(0, 10).page).toBe(1);
    expect(clampBetaParticipantsPagination(-5, 10).page).toBe(1);
  });

  it("caps page against max offset", () => {
    const maxPage = Math.floor(BETA_PARTICIPANTS_MAX_OFFSET / 10);
    expect(clampBetaParticipantsPagination(9999, 10).page).toBe(maxPage);
    expect(clampBetaParticipantsPagination(9999, 10).offset).toBe(
      (maxPage - 1) * 10,
    );
  });

  it("computes offset from clamped page and pageSize", () => {
    expect(clampBetaParticipantsPagination(3, 20)).toEqual({
      page: 3,
      pageSize: 20,
      offset: 40,
    });
  });
});

describe("boundBetaParticipantsInput", () => {
  it("truncates strings longer than the max length", () => {
    const long = "a".repeat(BETA_PARTICIPANTS_INPUT_MAX_LENGTH + 50);
    expect(boundBetaParticipantsInput(long)).toHaveLength(
      BETA_PARTICIPANTS_INPUT_MAX_LENGTH,
    );
  });

  it("returns empty string for nullish input", () => {
    expect(boundBetaParticipantsInput(null)).toBe("");
    expect(boundBetaParticipantsInput(undefined)).toBe("");
  });
});

describe("escapeIlikePattern / buildIlikeContainsPattern", () => {
  it("escapes ILIKE wildcards and backslashes", () => {
    expect(escapeIlikePattern("100%_done\\")).toBe("100\\%\\_done\\\\");
    expect(buildIlikeContainsPattern("100%_done\\")).toBe(
      "%100\\%\\_done\\\\%",
    );
  });

  it("bounds search input before escaping", () => {
    const long = "a".repeat(300);
    const pattern = buildIlikeContainsPattern(long);
    expect(pattern).toBe(`%${"a".repeat(BETA_PARTICIPANTS_INPUT_MAX_LENGTH)}%`);
  });
});

describe("deriveLatestAttemptStatus", () => {
  const now = new Date("2026-07-15T12:00:00Z");
  const future = new Date("2026-08-01T12:00:00Z");
  const past = new Date("2026-07-01T12:00:00Z");

  it("returns accepted when acceptedAt is set", () => {
    expect(
      deriveLatestAttemptStatus(
        { acceptedAt: now, revokedAt: null, expiresAt: future },
        now,
      ),
    ).toBe("accepted");
  });

  it("returns revoked when revokedAt is set without acceptance", () => {
    expect(
      deriveLatestAttemptStatus(
        { acceptedAt: null, revokedAt: now, expiresAt: future },
        now,
      ),
    ).toBe("revoked");
  });

  it("returns expired when past expiresAt", () => {
    expect(
      deriveLatestAttemptStatus(
        { acceptedAt: null, revokedAt: null, expiresAt: past },
        now,
      ),
    ).toBe("expired");
  });

  it("returns pending for live invitations", () => {
    expect(
      deriveLatestAttemptStatus(
        { acceptedAt: null, revokedAt: null, expiresAt: future },
        now,
      ),
    ).toBe("pending");
  });
});

describe("deriveJourneyStage", () => {
  it("caps at accepted when alliance is ambiguous", () => {
    expect(
      deriveJourneyStage({
        allianceAmbiguous: true,
        hasAccepted: true,
        allianceId: "a1",
        activeMemberCount: 5,
        hasTargetPeriodData: true,
        isComplete: true,
      }),
    ).toBe("accepted");
  });

  it("walks the full journey progression", () => {
    const base = {
      allianceAmbiguous: false,
      hasAccepted: false,
      allianceId: null as string | null,
      activeMemberCount: 0,
      hasTargetPeriodData: false,
      isComplete: false,
    };

    expect(deriveJourneyStage(base)).toBe("invited");

    expect(deriveJourneyStage({ ...base, hasAccepted: true })).toBe("accepted");

    expect(
      deriveJourneyStage({ ...base, hasAccepted: true, allianceId: "a1" }),
    ).toBe("alliance_created");

    expect(
      deriveJourneyStage({
        ...base,
        hasAccepted: true,
        allianceId: "a1",
        activeMemberCount: 3,
      }),
    ).toBe("roster_imported");

    expect(
      deriveJourneyStage({
        ...base,
        hasAccepted: true,
        allianceId: "a1",
        activeMemberCount: 3,
        hasTargetPeriodData: true,
      }),
    ).toBe("first_dataset_recorded");

    expect(
      deriveJourneyStage({
        ...base,
        hasAccepted: true,
        allianceId: "a1",
        activeMemberCount: 3,
        hasTargetPeriodData: true,
        isComplete: true,
      }),
    ).toBe("setup_complete");
  });
});

describe("deriveParticipantAttention", () => {
  const now = new Date("2026-07-29T12:00:00Z");

  function daysAgo(days: number): Date {
    return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  }

  it("returns null for complete setup", () => {
    expect(
      deriveParticipantAttention({
        now,
        latestStatus: "accepted",
        latestIssuedAt: daysAgo(30),
        latestExpiresAt: daysAgo(1),
        hasAccepted: true,
        firstAcceptedAt: daysAgo(20),
        allianceId: "a1",
        isComplete: true,
        lastSetupActivityAt: daysAgo(1),
      }),
    ).toEqual({ reason: null, since: null });
  });

  it("returns null for revoked latest with no acceptance", () => {
    expect(
      deriveParticipantAttention({
        now,
        latestStatus: "revoked",
        latestIssuedAt: daysAgo(10),
        latestExpiresAt: daysAgo(1),
        hasAccepted: false,
        firstAcceptedAt: null,
        allianceId: null,
        isComplete: false,
        lastSetupActivityAt: null,
      }),
    ).toEqual({ reason: null, since: null });
  });

  it("flags setup_stalled after 7 days without activity", () => {
    const lastActivity = daysAgo(BETA_PARTICIPANTS_ATTENTION_STALE_DAYS);
    const result = deriveParticipantAttention({
      now,
      latestStatus: "accepted",
      latestIssuedAt: daysAgo(30),
      latestExpiresAt: daysAgo(1),
      hasAccepted: true,
      firstAcceptedAt: daysAgo(20),
      allianceId: "a1",
      isComplete: false,
      lastSetupActivityAt: lastActivity,
    });
    expect(result.reason).toBe("setup_stalled");
    expect(result.since).toEqual(lastActivity);
  });

  it("does not flag setup_stalled when activity is recent", () => {
    const result = deriveParticipantAttention({
      now,
      latestStatus: "accepted",
      latestIssuedAt: daysAgo(30),
      latestExpiresAt: daysAgo(1),
      hasAccepted: true,
      firstAcceptedAt: daysAgo(20),
      allianceId: "a1",
      isComplete: false,
      lastSetupActivityAt: daysAgo(3),
    });
    expect(result.reason).not.toBe("setup_stalled");
  });

  it("flags accepted_no_alliance only after 7 days", () => {
    const acceptedAt = daysAgo(BETA_PARTICIPANTS_ATTENTION_STALE_DAYS);
    const result = deriveParticipantAttention({
      now,
      latestStatus: "accepted",
      latestIssuedAt: daysAgo(30),
      latestExpiresAt: daysAgo(1),
      hasAccepted: true,
      firstAcceptedAt: acceptedAt,
      allianceId: null,
      isComplete: false,
      lastSetupActivityAt: null,
    });
    expect(result).toEqual({
      reason: "accepted_no_alliance",
      since: acceptedAt,
    });

    const recent = deriveParticipantAttention({
      now,
      latestStatus: "accepted",
      latestIssuedAt: daysAgo(30),
      latestExpiresAt: daysAgo(1),
      hasAccepted: true,
      firstAcceptedAt: daysAgo(3),
      allianceId: null,
      isComplete: false,
      lastSetupActivityAt: null,
    });
    expect(recent.reason).toBeNull();
  });

  it("flags invitation_expired for expired unaccepted invitations", () => {
    const expiresAt = daysAgo(1);
    expect(
      deriveParticipantAttention({
        now,
        latestStatus: "expired",
        latestIssuedAt: daysAgo(14),
        latestExpiresAt: expiresAt,
        hasAccepted: false,
        firstAcceptedAt: null,
        allianceId: null,
        isComplete: false,
        lastSetupActivityAt: null,
      }),
    ).toEqual({ reason: "invitation_expired", since: expiresAt });
  });

  it("flags invitation_pending_stale at the 7-day boundary", () => {
    const issuedAt = daysAgo(BETA_PARTICIPANTS_ATTENTION_STALE_DAYS);
    const result = deriveParticipantAttention({
      now,
      latestStatus: "pending",
      latestIssuedAt: issuedAt,
      latestExpiresAt: daysAgo(-14),
      hasAccepted: false,
      firstAcceptedAt: null,
      allianceId: null,
      isComplete: false,
      lastSetupActivityAt: null,
    });
    expect(result).toEqual({
      reason: "invitation_pending_stale",
      since: issuedAt,
    });

    const justUnder = deriveParticipantAttention({
      now,
      latestStatus: "pending",
      latestIssuedAt: daysAgo(BETA_PARTICIPANTS_ATTENTION_STALE_DAYS - 1),
      latestExpiresAt: daysAgo(-14),
      hasAccepted: false,
      firstAcceptedAt: null,
      allianceId: null,
      isComplete: false,
      lastSetupActivityAt: null,
    });
    expect(justUnder.reason).toBeNull();
  });

  it("exercises exact boundary math for daysSince", () => {
    const then = daysAgo(BETA_PARTICIPANTS_ATTENTION_STALE_DAYS);
    expect(daysSince(now, then)).toBeGreaterThanOrEqual(
      BETA_PARTICIPANTS_ATTENTION_STALE_DAYS,
    );
    expect(daysSince(now, daysAgo(BETA_PARTICIPANTS_ATTENTION_STALE_DAYS - 0.5))).toBeLessThan(
      BETA_PARTICIPANTS_ATTENTION_STALE_DAYS,
    );
  });
});

describe("mapDeliverySummary (#175)", () => {
  const createdAt = new Date("2026-07-30T12:00:00Z");

  it("returns null when no delivery attempt row exists (renders as 'Not recorded')", () => {
    expect(
      mapDeliverySummary({
        delivery_id: null,
        delivery_trigger: null,
        delivery_status: null,
        delivery_created_at: null,
        delivery_failure_reason: null,
        delivery_provider_message_id: null,
        delivery_attempted_by_user_id: null,
        delivery_attempted_by_email: null,
        delivery_attempted_by_display_name: null,
      }),
    ).toBeNull();
  });

  it("maps a SENT row, translating DB enums to lowercase read-model values, including the attempted-by actor", () => {
    expect(
      mapDeliverySummary({
        delivery_id: "att-1",
        delivery_trigger: "ISSUE",
        delivery_status: "SENT",
        delivery_created_at: createdAt,
        delivery_failure_reason: null,
        delivery_provider_message_id: "msg-1",
        delivery_attempted_by_user_id: "op-1",
        delivery_attempted_by_email: "operator@example.test",
        delivery_attempted_by_display_name: "Operator One",
      }),
    ).toEqual({
      id: "att-1",
      trigger: "issue",
      status: "sent",
      createdAt,
      failureReason: null,
      providerMessageId: "msg-1",
      attemptedBy: {
        userId: "op-1",
        displayName: "Operator One",
        email: "operator@example.test",
      },
    });
  });

  it("retains the snapshotted email/displayName as attemptedBy even when attemptedByUserId is null (actor deleted after the fact)", () => {
    const result = mapDeliverySummary({
      delivery_id: "att-1b",
      delivery_trigger: "ISSUE",
      delivery_status: "SENT",
      delivery_created_at: createdAt,
      delivery_failure_reason: null,
      delivery_provider_message_id: "msg-1b",
      delivery_attempted_by_user_id: null,
      delivery_attempted_by_email: "deleted-operator@example.test",
      delivery_attempted_by_display_name: "Deleted Operator",
    });

    expect(result?.attemptedBy).toEqual({
      userId: null,
      displayName: "Deleted Operator",
      email: "deleted-operator@example.test",
    });
  });

  it("falls back to a null attemptedBy only in the defensive case where all three fields are missing (not a real #175 state — attemptedByEmail is required on every row)", () => {
    const result = mapDeliverySummary({
      delivery_id: "att-1c",
      delivery_trigger: "ISSUE",
      delivery_status: "SENT",
      delivery_created_at: createdAt,
      delivery_failure_reason: null,
      delivery_provider_message_id: "msg-1c",
      delivery_attempted_by_user_id: null,
      delivery_attempted_by_email: null,
      delivery_attempted_by_display_name: null,
    });

    expect(result?.attemptedBy).toBeNull();
  });

  it("maps a FAILED resend row with its failure reason", () => {
    expect(
      mapDeliverySummary({
        delivery_id: "att-2",
        delivery_trigger: "RESEND",
        delivery_status: "FAILED",
        delivery_created_at: createdAt,
        delivery_failure_reason: "Provider rejected the request",
        delivery_provider_message_id: null,
        delivery_attempted_by_user_id: "op-2",
        delivery_attempted_by_email: "operator2@example.test",
        delivery_attempted_by_display_name: null,
      }),
    ).toEqual({
      id: "att-2",
      trigger: "resend",
      status: "failed",
      createdAt,
      failureReason: "Provider rejected the request",
      providerMessageId: null,
      attemptedBy: {
        userId: "op-2",
        displayName: null,
        email: "operator2@example.test",
      },
    });
  });

  it("maps a SKIPPED reissue row", () => {
    expect(
      mapDeliverySummary({
        delivery_id: "att-3",
        delivery_trigger: "REISSUE",
        delivery_status: "SKIPPED",
        delivery_created_at: createdAt,
        delivery_failure_reason: null,
        delivery_provider_message_id: null,
        delivery_attempted_by_user_id: "op-3",
        delivery_attempted_by_email: "operator3@example.test",
        delivery_attempted_by_display_name: "Operator Three",
      }),
    ).toEqual({
      id: "att-3",
      trigger: "reissue",
      status: "skipped",
      createdAt,
      failureReason: null,
      providerMessageId: null,
      attemptedBy: {
        userId: "op-3",
        displayName: "Operator Three",
        email: "operator3@example.test",
      },
    });
  });
});

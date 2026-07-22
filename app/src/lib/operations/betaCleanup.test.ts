import { describe, it, expect } from "vitest";
import {
  assembleTenantPlan,
  assembleUserPlan,
  mergePlans,
  summarizeDeletes,
  toChecksumPayload,
  computeChecksum,
  buildManifest,
  verifyManifest,
  parseArgs,
  keepListViolations,
  canonicalJson,
  type TenantResolved,
  type UserResolved,
  type CleanupOp,
} from "./betaCleanup";

const tenant: TenantResolved = {
  allianceId: "A1",
  memberMetricEntryIds: ["mme1"],
  leadershipNoteIds: ["ln1"],
  invitationIds: ["inv1"],
  metricPeriodMetricKeys: ["p1::m1"],
  metricIds: ["m1"],
  metricPeriodIds: ["p1"],
  allianceMemberIds: ["am1"],
  allianceMembershipIds: ["ms1"],
  betaInvitationIds: ["bi1"],
};

const user: UserResolved = {
  userId: "U1",
  passwordResetTokenIds: ["prt1"],
  emailChangeRequestIds: [],
  feedbackIds: ["fb1"],
  leadershipNoteIds: ["ln9"],
  invitationSentIds: ["invSent1"],
  invitationAcceptedIds: ["invAcc1"],
  betaInvitationAcceptedIds: ["biAcc1"],
  allianceMemberLinkedIds: ["amLinked1"],
  allianceMembershipIds: ["ms9"],
};

describe("assembleTenantPlan", () => {
  it("orders children before the Alliance and disassociates beta invitations", () => {
    const plan = assembleTenantPlan(tenant);
    const models = plan.map((o) => `${o.kind}:${o.model}`);
    expect(models).toEqual([
      "delete:MemberMetricEntry",
      "delete:LeadershipNote",
      "delete:Invitation",
      "delete:MetricPeriodMetric",
      "delete:Metric",
      "delete:MetricPeriod",
      "delete:AllianceMember",
      "delete:AllianceMembership",
      "nullify:BetaInvitation",
      "delete:Alliance",
    ]);
    // Alliance is always last.
    expect(plan[plan.length - 1].model).toBe("Alliance");
  });

  it("drops empty steps", () => {
    const plan = assembleTenantPlan({ ...tenant, metricIds: [], leadershipNoteIds: [] });
    expect(plan.some((o) => o.model === "Metric")).toBe(false);
    expect(plan.some((o) => o.model === "LeadershipNote")).toBe(false);
  });
});

describe("assembleUserPlan", () => {
  it("deletes owned rows, disassociates references, and deletes User last", () => {
    const plan = assembleUserPlan(user);
    const models = plan.map((o) => `${o.kind}:${o.model}:${o.field ?? ""}`);
    expect(models).toEqual([
      "delete:PasswordResetToken:",
      "delete:Feedback:",
      "delete:LeadershipNote:",
      "delete:Invitation:",
      "nullify:Invitation:acceptedByUserId",
      "nullify:BetaInvitation:acceptedByUserId",
      "nullify:AllianceMember:userId",
      "delete:AllianceMembership:",
      "delete:User:",
    ]);
    expect(plan[plan.length - 1].model).toBe("User");
    // EmailChangeRequest had no ids, so its step is dropped.
    expect(plan.some((o) => o.model === "EmailChangeRequest")).toBe(false);
  });
});

describe("mergePlans", () => {
  it("coalesces ids for the same op and keeps first-seen FK ordering", () => {
    const a: CleanupOp[] = [
      { kind: "delete", model: "AllianceMembership", ids: ["ms1"], reason: "a" },
      { kind: "delete", model: "Alliance", ids: ["A1"], reason: "a" },
    ];
    const b: CleanupOp[] = [
      { kind: "delete", model: "AllianceMembership", ids: ["ms2", "ms1"], reason: "b" },
    ];
    const merged = mergePlans([a, b]);
    const membership = merged.find((o) => o.model === "AllianceMembership")!;
    expect(membership.ids).toEqual(["ms1", "ms2"]);
    // AllianceMembership stays before Alliance (first-seen order).
    expect(merged.map((o) => o.model)).toEqual(["AllianceMembership", "Alliance"]);
  });
});

describe("summarizeDeletes", () => {
  it("counts only delete ops, not nullify/revoke", () => {
    const plan: CleanupOp[] = [
      { kind: "delete", model: "Feedback", ids: ["f1", "f2"], reason: "" },
      { kind: "nullify", model: "AllianceMember", field: "userId", ids: ["am1"], reason: "" },
      { kind: "revoke", model: "BetaInvitation", field: "revokedAt", ids: ["bi1"], reason: "" },
    ];
    expect(summarizeDeletes(plan)).toEqual({ Feedback: 2 });
  });
});

describe("checksum + manifest", () => {
  const plan = mergePlans([assembleTenantPlan(tenant), assembleUserPlan(user)]);
  const base = {
    cutoff: null,
    dbIdentity: "ep-prod-000000",
    keep: { userEmails: ["Keep@Example.com"], allianceIds: ["KEEP"] },
    plan,
  };

  it("is stable regardless of id order and key order", () => {
    const p1 = toChecksumPayload(base);
    const shuffled = {
      ...base,
      keep: { userEmails: ["keep@example.com"], allianceIds: ["KEEP"] },
      plan: plan.map((o) => ({ ...o, ids: [...o.ids].reverse() })),
    };
    const p2 = toChecksumPayload(shuffled);
    expect(computeChecksum(p1)).toBe(computeChecksum(p2));
  });

  it("changes when an id is added", () => {
    const before = computeChecksum(toChecksumPayload(base));
    const mutated = {
      ...base,
      plan: plan.map((o) =>
        o.model === "Feedback" ? { ...o, ids: [...o.ids, "sneaky"] } : o
      ),
    };
    const after = computeChecksum(toChecksumPayload(mutated));
    expect(after).not.toBe(before);
  });

  it("canonicalJson sorts nested keys", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it("verifyManifest accepts an unchanged re-resolution", () => {
    const manifest = buildManifest(base);
    const verdict = verifyManifest(manifest, {
      dbIdentity: "ep-prod-000000",
      payload: toChecksumPayload(base),
    });
    expect(verdict.ok).toBe(true);
  });

  it("verifyManifest rejects a different target database", () => {
    const manifest = buildManifest(base);
    const verdict = verifyManifest(manifest, {
      dbIdentity: "ep-preview-999999",
      payload: toChecksumPayload({ ...base, dbIdentity: "ep-preview-999999" }),
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toMatch(/different|current target/i);
  });

  it("verifyManifest rejects a drifted plan", () => {
    const manifest = buildManifest(base);
    const drifted = {
      ...base,
      plan: plan.map((o) =>
        o.model === "Feedback" ? { ...o, ids: [...o.ids, "new-row"] } : o
      ),
    };
    const verdict = verifyManifest(manifest, {
      dbIdentity: "ep-prod-000000",
      payload: toChecksumPayload(drifted),
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toMatch(/changed since the dry run/i);
  });
});

describe("keepListViolations", () => {
  it("flags a plan that would delete a keep-listed user", () => {
    const plan: CleanupOp[] = [
      { kind: "delete", model: "User", ids: ["U1", "KEEPME"], reason: "" },
    ];
    expect(keepListViolations(plan, ["KEEPME"])).toEqual(["KEEPME"]);
  });

  it("is empty when no user delete is present", () => {
    const plan: CleanupOp[] = [
      { kind: "delete", model: "Feedback", ids: ["f1"], reason: "" },
    ];
    expect(keepListViolations(plan, ["KEEPME"])).toEqual([]);
  });
});

describe("parseArgs", () => {
  it("defaults to a dry run", () => {
    const args = parseArgs([]);
    expect(args.execute).toBe(false);
    expect(args.manifestPath).toBe("./beta-cleanup-manifest.json");
  });

  it("collects repeatable selections and lowercases emails", () => {
    const args = parseArgs([
      "--alliance-id", "A1",
      "--alliance-id", "A2",
      "--user-email", "Test@Example.com",
      "--keep-user-email", "OWNER@example.com",
      "--execute",
      "--confirm-production",
      "--manifest", "/tmp/m.json",
    ]);
    expect(args.allianceIds).toEqual(["A1", "A2"]);
    expect(args.userEmails).toEqual(["test@example.com"]);
    expect(args.keepUserEmails).toEqual(["owner@example.com"]);
    expect(args.execute).toBe(true);
    expect(args.confirmProduction).toBe(true);
    expect(args.manifestPath).toBe("/tmp/m.json");
  });

  it("parses stale category flags and explicit id lists", () => {
    const args = parseArgs([
      "--include-expired-reset-tokens",
      "--include-stale-beta-invitations",
      "--feedback-ids", "f1,f2 f3",
      "--access-request-ids", "ar1",
      "--cutoff-days", "30",
    ]);
    expect(args.stale.expiredResetTokens).toBe(true);
    expect(args.stale.betaInvitations).toBe(true);
    expect(args.stale.invitations).toBe(false);
    expect(args.feedbackIds).toEqual(["f1", "f2", "f3"]);
    expect(args.accessRequestIds).toEqual(["ar1"]);
    expect(args.cutoffDays).toBe(30);
  });

  it("rejects unknown flags and missing values", () => {
    expect(() => parseArgs(["--nope"])).toThrow(/Unknown argument/);
    expect(() => parseArgs(["--alliance-id"])).toThrow(/requires a value/);
    expect(() => parseArgs(["--cutoff-days", "-1"])).toThrow(/non-negative/);
  });
});

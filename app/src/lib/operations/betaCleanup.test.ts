import { describe, it, expect } from "vitest";
import {
  assembleTenantPlan,
  assembleUserPlan,
  mergePlans,
  summarizeDeletes,
  summarizeOpCounts,
  planOpKey,
  toChecksumPayload,
  computeChecksum,
  buildManifest,
  verifyManifest,
  verifyManifestIntegrity,
  validateManifestShape,
  resolveCutoffDate,
  validateSelectionOverlaps,
  parseArgs,
  keepListViolations,
  allianceKeepListViolations,
  canonicalJson,
  EXECUTION_CONFIRMATION_PHRASE,
  type TenantResolved,
  type UserResolved,
  type CleanupOp,
  type CleanupArgs,
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

  it("drops a nullify/revoke id once the same row is also deleted (deletion takes precedence)", () => {
    // A tenant deletes Invitation inv1; a separately-selected user who
    // accepted inv1 would otherwise nullify Invitation.acceptedByUserId=inv1.
    // Once inv1 is deleted, that update would affect 0 rows — it must be
    // dropped from the merged plan rather than rejected at execute time.
    const tenantPlan: CleanupOp[] = [
      { kind: "delete", model: "Invitation", ids: ["inv1", "inv2"], reason: "tenant" },
    ];
    const userPlan: CleanupOp[] = [
      {
        kind: "nullify",
        model: "Invitation",
        field: "acceptedByUserId",
        ids: ["inv1", "inv3"],
        reason: "user",
      },
    ];
    const merged = mergePlans([tenantPlan, userPlan]);
    const del = merged.find((o) => o.kind === "delete" && o.model === "Invitation")!;
    expect(del.ids).toEqual(["inv1", "inv2"]);
    // inv1 dropped (also deleted); inv3 (never deleted) survives.
    const nullify = merged.find((o) => o.kind === "nullify" && o.model === "Invitation");
    expect(nullify?.ids).toEqual(["inv3"]);
  });

  it("drops the whole nullify/revoke op when every id it targets is also deleted", () => {
    const tenantPlan: CleanupOp[] = [
      { kind: "delete", model: "BetaInvitation", ids: ["bi1"], reason: "tenant" },
    ];
    const otherPlan: CleanupOp[] = [
      { kind: "nullify", model: "BetaInvitation", field: "allianceId", ids: ["bi1"], reason: "other" },
    ];
    const merged = mergePlans([tenantPlan, otherPlan]);
    expect(merged.some((o) => o.kind === "nullify" && o.model === "BetaInvitation")).toBe(false);
    expect(merged.find((o) => o.kind === "delete" && o.model === "BetaInvitation")!.ids).toEqual(["bi1"]);
  });

  it("does not let a delete affect a different model's nullify/revoke ids", () => {
    const a: CleanupOp[] = [{ kind: "delete", model: "Invitation", ids: ["shared-id"], reason: "a" }];
    const b: CleanupOp[] = [
      { kind: "nullify", model: "AllianceMember", field: "userId", ids: ["shared-id"], reason: "b" },
    ];
    const merged = mergePlans([a, b]);
    expect(merged.find((o) => o.model === "AllianceMember")!.ids).toEqual(["shared-id"]);
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

  it("requires an explicit --cutoff-days when stale-by-age cleanup is enabled", () => {
    expect(() => parseArgs(["--include-stale-beta-invitations"])).toThrow(/--cutoff-days is required/);
    expect(() => parseArgs(["--include-stale-invitations"])).toThrow(/--cutoff-days is required/);
    // Explicit --cutoff-days 0 is a deliberate operator choice, not the silent default.
    expect(() =>
      parseArgs(["--include-stale-beta-invitations", "--cutoff-days", "0"])
    ).not.toThrow();
    // Unrelated stale categories don't require it.
    expect(() => parseArgs(["--include-expired-reset-tokens"])).not.toThrow();
  });

  it("parses --verify and the exact --confirm phrase", () => {
    const args = parseArgs(["--verify", "--manifest", "/tmp/m.json"]);
    expect(args.verify).toBe(true);

    const execArgs = parseArgs(["--execute", "--confirm", EXECUTION_CONFIRMATION_PHRASE]);
    expect(execArgs.confirmPhrase).toBe(EXECUTION_CONFIRMATION_PHRASE);
  });
});

describe("allianceKeepListViolations", () => {
  it("flags a plan that would delete a keep-listed alliance", () => {
    const plan: CleanupOp[] = [
      { kind: "delete", model: "Alliance", ids: ["A1", "SMOKE"], reason: "" },
    ];
    expect(allianceKeepListViolations(plan, ["SMOKE"])).toEqual(["SMOKE"]);
  });

  it("is empty when no alliance delete is present", () => {
    const plan: CleanupOp[] = [{ kind: "delete", model: "Feedback", ids: ["f1"], reason: "" }];
    expect(allianceKeepListViolations(plan, ["SMOKE"])).toEqual([]);
  });
});

describe("validateSelectionOverlaps", () => {
  const baseArgs: CleanupArgs = {
    execute: false,
    verify: false,
    confirmProduction: false,
    confirmPhrase: null,
    manifestPath: "./m.json",
    allianceIds: [],
    userEmails: [],
    keepAllianceIds: [],
    keepUserEmails: [],
    cutoffDays: 0,
    stale: { betaInvitations: false, invitations: false, expiredResetTokens: false, consumedEmailChanges: false },
    accessRequestIds: [],
    feedbackIds: [],
  };

  it("flags an alliance selected for both deletion and keep", () => {
    const problems = validateSelectionOverlaps({
      ...baseArgs,
      allianceIds: ["A1"],
      keepAllianceIds: ["A1"],
    });
    expect(problems.length).toBe(1);
    expect(problems[0]).toMatch(/alliance-id and --keep-alliance-id overlap/);
  });

  it("flags a user selected for both deletion and keep", () => {
    const problems = validateSelectionOverlaps({
      ...baseArgs,
      userEmails: ["a@example.com"],
      keepUserEmails: ["a@example.com"],
    });
    expect(problems.length).toBe(1);
    expect(problems[0]).toMatch(/user-email and --keep-user-email overlap/);
  });

  it("is empty for disjoint selections", () => {
    const problems = validateSelectionOverlaps({
      ...baseArgs,
      allianceIds: ["A1"],
      keepAllianceIds: ["A2"],
      userEmails: ["a@example.com"],
      keepUserEmails: ["b@example.com"],
    });
    expect(problems).toEqual([]);
  });
});

describe("summarizeOpCounts / planOpKey", () => {
  it("counts every op kind (not just deletes) keyed by kind:model:field", () => {
    const plan: CleanupOp[] = [
      { kind: "delete", model: "Feedback", ids: ["f1", "f2"], reason: "" },
      { kind: "nullify", model: "AllianceMember", field: "userId", ids: ["am1"], reason: "" },
      { kind: "revoke", model: "BetaInvitation", field: "revokedAt", ids: ["bi1", "bi2", "bi3"], reason: "" },
    ];
    expect(summarizeOpCounts(plan)).toEqual({
      "delete:Feedback:": 2,
      "nullify:AllianceMember:userId": 1,
      "revoke:BetaInvitation:revokedAt": 3,
    });
    expect(planOpKey(plan[1])).toBe("nullify:AllianceMember:userId");
  });
});

describe("resolveCutoffDate", () => {
  it("computes now - cutoffDays when no frozen cutoff is given (dry run)", () => {
    const now = new Date("2026-07-22T12:00:00.000Z");
    const cutoff = resolveCutoffDate({ cutoffDays: 30, frozenCutoffIso: null, now });
    expect(cutoff.toISOString()).toBe("2026-06-22T12:00:00.000Z");
  });

  it("reuses the frozen cutoff verbatim regardless of how much time has passed (execute)", () => {
    const dryRunNow = new Date("2026-07-22T12:00:00.000Z");
    const frozen = resolveCutoffDate({ cutoffDays: 30, frozenCutoffIso: null, now: dryRunNow }).toISOString();

    // Simulate executing hours (or days) after the dry run — "now" moved on,
    // but the resolved cutoff must be identical, or every execute would drift.
    const executeNow = new Date("2026-07-23T18:30:00.000Z");
    const atExecute = resolveCutoffDate({ cutoffDays: 30, frozenCutoffIso: frozen, now: executeNow });
    expect(atExecute.toISOString()).toBe(frozen);
    expect(atExecute.toISOString()).not.toBe(
      resolveCutoffDate({ cutoffDays: 30, frozenCutoffIso: null, now: executeNow }).toISOString()
    );
  });

  it("throws on a malformed frozen cutoff", () => {
    expect(() =>
      resolveCutoffDate({ cutoffDays: 30, frozenCutoffIso: "not-a-date", now: new Date() })
    ).toThrow(/not a valid date/);
  });
});

describe("manifest integrity + shape validation", () => {
  const tenantPlan = mergePlans([assembleTenantPlan(tenant)]);
  const args = {
    cutoff: null,
    dbIdentity: "ep-prod-000000",
    keep: { userEmails: [], allianceIds: [] },
    plan: tenantPlan,
  };

  it("verifyManifestIntegrity accepts a well-formed, untampered manifest", () => {
    const manifest = buildManifest(args);
    expect(verifyManifestIntegrity(manifest)).toEqual({ ok: true });
  });

  it("verifyManifestIntegrity rejects a manifest whose ops were edited after checksum", () => {
    const manifest = buildManifest(args);
    const tampered = {
      ...manifest,
      ops: manifest.ops.map((o) =>
        o.model === "Alliance" ? { ...o, ids: [...o.ids, "sneaky-extra-id"] } : o
      ),
    };
    const verdict = verifyManifestIntegrity(tampered);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toMatch(/does not match its own recorded contents/);
  });

  it("validateManifestShape throws on missing required fields", () => {
    expect(() => validateManifestShape({})).toThrow(/Invalid manifest/);
    expect(() => validateManifestShape(null)).toThrow(/Invalid manifest/);
    expect(() => validateManifestShape({ version: 1 })).toThrow(/checksum/);
  });

  it("validateManifestShape accepts a real manifest and returns it typed", () => {
    const manifest = buildManifest(args);
    expect(validateManifestShape(manifest)).toEqual(manifest);
  });

  it("validateManifestShape rejects an op with an unknown model", () => {
    const manifest = buildManifest(args);
    const bad = { ...manifest, ops: [{ kind: "delete", model: "NotARealModel", field: null, ids: ["x"] }] };
    expect(() => validateManifestShape(bad)).toThrow(/model is invalid/);
  });

  it("validateManifestShape rejects a nullify/revoke op with no field", () => {
    const manifest = buildManifest(args);
    const bad = { ...manifest, ops: [{ kind: "nullify", model: "AllianceMember", field: null, ids: ["x"] }] };
    expect(() => validateManifestShape(bad)).toThrow(/field is required/);
  });

  it("validateManifestShape rejects a delete op that carries a field", () => {
    const manifest = buildManifest(args);
    const bad = { ...manifest, ops: [{ kind: "delete", model: "Alliance", field: "oops", ids: ["x"] }] };
    expect(() => validateManifestShape(bad)).toThrow(/field must be null/);
  });

  it("validateManifestShape rejects non-string ids", () => {
    const manifest = buildManifest(args);
    const bad = { ...manifest, ops: [{ kind: "delete", model: "Alliance", field: null, ids: [123] }] };
    expect(() => validateManifestShape(bad)).toThrow(/array of strings/);
  });

  it("validateManifestShape rejects a malformed MetricPeriodMetric composite key", () => {
    const manifest = buildManifest(args);
    const bad = {
      ...manifest,
      ops: [{ kind: "delete", model: "MetricPeriodMetric", field: null, ids: ["not-a-composite-key"] }],
    };
    expect(() => validateManifestShape(bad)).toThrow(/malformed MetricPeriodMetric key/);
  });

  it("validateManifestShape accepts a well-formed MetricPeriodMetric composite key", () => {
    const manifest = buildManifest(args);
    const good = {
      ...manifest,
      ops: [{ kind: "delete", model: "MetricPeriodMetric", field: null, ids: ["p1::m1"] }],
    };
    expect(() => validateManifestShape(good)).not.toThrow();
  });
});

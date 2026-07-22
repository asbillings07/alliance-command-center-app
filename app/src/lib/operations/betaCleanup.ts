import { createHash } from "node:crypto";

/**
 * Beta data cleanup — pure planning core (issue #161).
 *
 * This module contains NO database access. It turns already-resolved id sets
 * into an ordered, deterministic deletion plan, and binds a reviewed dry run to
 * its later execution via a checksum. The DB queries and execution live in
 * `scripts/cleanup-beta-data.ts`, which keeps the risky IO thin and this logic
 * unit-testable.
 *
 * Design constraints (from the beta-readiness review):
 *   - dry-run is the default; execution replays ONLY the recorded ids;
 *   - tenant deletion and user deletion are separate concerns;
 *   - deletion is FK-ordered (children before parents), since only
 *     PasswordResetToken/EmailChangeRequest cascade from User in the schema;
 *   - stale-artifact cleanup is conservative and per-category (Feedback and
 *     AccessRequest only by explicit id, never by age; invitations preferred
 *     revoked, not deleted).
 */

export type CleanupModel =
  | "PasswordResetToken"
  | "EmailChangeRequest"
  | "MemberMetricEntry"
  | "LeadershipNote"
  | "Invitation"
  | "MetricPeriodMetric"
  | "Metric"
  | "MetricPeriod"
  | "AllianceMember"
  | "AllianceMembership"
  | "BetaInvitation"
  | "Feedback"
  | "AccessRequest"
  | "Alliance"
  | "User";

/**
 * A single ordered plan step.
 * - `delete`: remove rows by primary key (composite keys for MetricPeriodMetric
 *   are encoded as `${periodId}::${metricId}`).
 * - `nullify`: set `field` to null on rows by primary key (disassociate).
 * - `revoke`: set `field` to the execution timestamp (soft-remove, preserving
 *   the audit row).
 */
export type OpKind = "delete" | "nullify" | "revoke";

export interface CleanupOp {
  kind: OpKind;
  model: CleanupModel;
  ids: string[];
  /** Column to null (`nullify`) or timestamp (`revoke`). */
  field?: string;
  /** Human-readable justification, for the console + manifest. */
  reason: string;
}

/** Ids resolved for one tenant (alliance) deletion, children first. */
export interface TenantResolved {
  allianceId: string;
  memberMetricEntryIds: string[];
  leadershipNoteIds: string[];
  invitationIds: string[];
  /** `${periodId}::${metricId}` composite keys. */
  metricPeriodMetricKeys: string[];
  metricIds: string[];
  metricPeriodIds: string[];
  allianceMemberIds: string[];
  allianceMembershipIds: string[];
  /** Beta invitations pointing at this alliance — disassociated, not deleted. */
  betaInvitationIds: string[];
}

/** Ids resolved for one user (account) deletion. */
export interface UserResolved {
  userId: string;
  passwordResetTokenIds: string[];
  emailChangeRequestIds: string[];
  feedbackIds: string[];
  /** Notes authored by this user. */
  leadershipNoteIds: string[];
  /** Invitations SENT by this user (invitedById). */
  invitationSentIds: string[];
  /** Invitations this user ACCEPTED (acceptedByUserId) — disassociated. */
  invitationAcceptedIds: string[];
  /** Beta invitations this user accepted (acceptedByUserId) — disassociated. */
  betaInvitationAcceptedIds: string[];
  /** AllianceMember rows linked to this user — unlinked (userId set null). */
  allianceMemberLinkedIds: string[];
  allianceMembershipIds: string[];
}

/** Build the FK-ordered ops for deleting one tenant's owned records. */
export function assembleTenantPlan(r: TenantResolved): CleanupOp[] {
  const reason = `alliance ${r.allianceId}`;
  const ops: CleanupOp[] = [
    { kind: "delete", model: "MemberMetricEntry", ids: r.memberMetricEntryIds, reason },
    { kind: "delete", model: "LeadershipNote", ids: r.leadershipNoteIds, reason },
    { kind: "delete", model: "Invitation", ids: r.invitationIds, reason },
    { kind: "delete", model: "MetricPeriodMetric", ids: r.metricPeriodMetricKeys, reason },
    { kind: "delete", model: "Metric", ids: r.metricIds, reason },
    { kind: "delete", model: "MetricPeriod", ids: r.metricPeriodIds, reason },
    { kind: "delete", model: "AllianceMember", ids: r.allianceMemberIds, reason },
    { kind: "delete", model: "AllianceMembership", ids: r.allianceMembershipIds, reason },
    {
      kind: "nullify",
      model: "BetaInvitation",
      field: "allianceId",
      ids: r.betaInvitationIds,
      reason: `disassociate from deleted ${reason}`,
    },
    { kind: "delete", model: "Alliance", ids: [r.allianceId], reason },
  ];
  return ops.filter(hasWork);
}

/** Build the FK-ordered ops for deleting one user account. */
export function assembleUserPlan(r: UserResolved): CleanupOp[] {
  const reason = `user ${r.userId}`;
  const ops: CleanupOp[] = [
    { kind: "delete", model: "PasswordResetToken", ids: r.passwordResetTokenIds, reason },
    { kind: "delete", model: "EmailChangeRequest", ids: r.emailChangeRequestIds, reason },
    { kind: "delete", model: "Feedback", ids: r.feedbackIds, reason },
    { kind: "delete", model: "LeadershipNote", ids: r.leadershipNoteIds, reason: `authored by ${reason}` },
    { kind: "delete", model: "Invitation", ids: r.invitationSentIds, reason: `sent by ${reason}` },
    {
      kind: "nullify",
      model: "Invitation",
      field: "acceptedByUserId",
      ids: r.invitationAcceptedIds,
      reason: `accepted by deleted ${reason}`,
    },
    {
      kind: "nullify",
      model: "BetaInvitation",
      field: "acceptedByUserId",
      ids: r.betaInvitationAcceptedIds,
      reason: `accepted by deleted ${reason}`,
    },
    {
      kind: "nullify",
      model: "AllianceMember",
      field: "userId",
      ids: r.allianceMemberLinkedIds,
      reason: `unlink deleted ${reason}`,
    },
    { kind: "delete", model: "AllianceMembership", ids: r.allianceMembershipIds, reason },
    { kind: "delete", model: "User", ids: [r.userId], reason },
  ];
  return ops.filter(hasWork);
}

function hasWork(op: CleanupOp): boolean {
  return op.ids.length > 0;
}

function opKey(op: CleanupOp): string {
  return `${op.kind}:${op.model}:${op.field ?? ""}`;
}

/**
 * Merge many sub-plans (one per tenant/user + stale categories) into a single
 * ordered plan. Ops of the same (kind, model, field) are coalesced with their
 * ids de-duplicated and sorted; the FIRST occurrence fixes execution position,
 * preserving the FK ordering established by the assemblers.
 */
export function mergePlans(plans: CleanupOp[][]): CleanupOp[] {
  const order: string[] = [];
  const byKey = new Map<string, CleanupOp>();

  for (const plan of plans) {
    for (const op of plan) {
      const key = opKey(op);
      const existing = byKey.get(key);
      if (existing) {
        existing.ids = uniqueSorted([...existing.ids, ...op.ids]);
      } else {
        order.push(key);
        byKey.set(key, { ...op, ids: uniqueSorted(op.ids) });
      }
    }
  }

  return order.map((key) => byKey.get(key)!).filter(hasWork);
}

function uniqueSorted(ids: string[]): string[] {
  return Array.from(new Set(ids)).sort();
}

/** Per-model counts a plan will delete (nullify/revoke are not deletions). */
export function summarizeDeletes(plan: CleanupOp[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const op of plan) {
    if (op.kind !== "delete") continue;
    counts[op.model] = (counts[op.model] ?? 0) + op.ids.length;
  }
  return counts;
}

/** Human summary of every op (delete/nullify/revoke) for the console + manifest. */
export function summarizePlan(plan: CleanupOp[]): Array<{
  kind: OpKind;
  model: CleanupModel;
  field?: string;
  count: number;
  reason: string;
}> {
  return plan.map((op) => ({
    kind: op.kind,
    model: op.model,
    field: op.field,
    count: op.ids.length,
    reason: op.reason,
  }));
}

export interface ChecksumPayload {
  version: number;
  cutoff: string | null;
  dbIdentity: string;
  keep: { userEmails: string[]; allianceIds: string[] };
  ops: Array<{ kind: OpKind; model: CleanupModel; field: string | null; ids: string[] }>;
}

export const MANIFEST_VERSION = 1 as const;

/** Stable payload the checksum is computed over (order-independent for ids). */
export function toChecksumPayload(args: {
  cutoff: string | null;
  dbIdentity: string;
  keep: { userEmails: string[]; allianceIds: string[] };
  plan: CleanupOp[];
}): ChecksumPayload {
  return {
    version: MANIFEST_VERSION,
    cutoff: args.cutoff,
    dbIdentity: args.dbIdentity,
    keep: {
      userEmails: uniqueSorted(args.keep.userEmails.map((e) => e.toLowerCase())),
      allianceIds: uniqueSorted(args.keep.allianceIds),
    },
    ops: args.plan.map((op) => ({
      kind: op.kind,
      model: op.model,
      field: op.field ?? null,
      ids: uniqueSorted(op.ids),
    })),
  };
}

/** Deterministic JSON with recursively sorted object keys. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) out[key] = sortKeys(obj[key]);
    return out;
  }
  return value;
}

export function computeChecksum(payload: ChecksumPayload): string {
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

export interface CleanupManifest extends ChecksumPayload {
  generatedAt: string;
  checksum: string;
  deleteCounts: Record<string, number>;
}

export function buildManifest(args: {
  cutoff: string | null;
  dbIdentity: string;
  keep: { userEmails: string[]; allianceIds: string[] };
  plan: CleanupOp[];
  now?: Date;
}): CleanupManifest {
  const payload = toChecksumPayload(args);
  return {
    ...payload,
    generatedAt: (args.now ?? new Date()).toISOString(),
    checksum: computeChecksum(payload),
    deleteCounts: summarizeDeletes(args.plan),
  };
}

export type ManifestVerdict =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Confirm the freshly-resolved plan still matches the reviewed manifest. Guards
 * against the database changing between dry-run review and execution, and
 * against executing a manifest generated for a different database.
 */
export function verifyManifest(
  manifest: CleanupManifest,
  fresh: { dbIdentity: string; payload: ChecksumPayload }
): ManifestVerdict {
  if (manifest.version !== MANIFEST_VERSION) {
    return { ok: false, reason: `manifest version ${manifest.version} is unsupported` };
  }
  if (manifest.dbIdentity !== fresh.dbIdentity) {
    return {
      ok: false,
      reason: `manifest was generated for database "${manifest.dbIdentity}" but the current target is "${fresh.dbIdentity}"`,
    };
  }
  const freshChecksum = computeChecksum(fresh.payload);
  if (manifest.checksum !== freshChecksum) {
    return {
      ok: false,
      reason:
        "the database changed since the dry run (re-resolved plan checksum does not match the manifest); regenerate and re-review the manifest",
    };
  }
  return { ok: true };
}

// --- CLI argument parsing (pure) --------------------------------------------

export interface CleanupArgs {
  execute: boolean;
  confirmProduction: boolean;
  manifestPath: string;
  allianceIds: string[];
  userEmails: string[];
  keepAllianceIds: string[];
  keepUserEmails: string[];
  cutoffDays: number;
  stale: {
    betaInvitations: boolean;
    invitations: boolean;
    expiredResetTokens: boolean;
    consumedEmailChanges: boolean;
  };
  /** Explicit-id-only categories (never selected by age). */
  accessRequestIds: string[];
  feedbackIds: string[];
}

const DEFAULT_MANIFEST_PATH = "./beta-cleanup-manifest.json";

export function parseArgs(argv: string[]): CleanupArgs {
  const args: CleanupArgs = {
    execute: false,
    confirmProduction: false,
    manifestPath: DEFAULT_MANIFEST_PATH,
    allianceIds: [],
    userEmails: [],
    keepAllianceIds: [],
    keepUserEmails: [],
    cutoffDays: 0,
    stale: {
      betaInvitations: false,
      invitations: false,
      expiredResetTokens: false,
      consumedEmailChanges: false,
    },
    accessRequestIds: [],
    feedbackIds: [],
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) {
        throw new Error(`Flag ${arg} requires a value`);
      }
      i++;
      return v;
    };
    switch (arg) {
      case "--execute":
        args.execute = true;
        break;
      case "--confirm-production":
        args.confirmProduction = true;
        break;
      case "--manifest":
        args.manifestPath = next();
        break;
      case "--alliance-id":
        args.allianceIds.push(next());
        break;
      case "--user-email":
        args.userEmails.push(next().toLowerCase());
        break;
      case "--keep-alliance-id":
        args.keepAllianceIds.push(next());
        break;
      case "--keep-user-email":
        args.keepUserEmails.push(next().toLowerCase());
        break;
      case "--cutoff-days":
        args.cutoffDays = parseCutoffDays(next());
        break;
      case "--include-stale-beta-invitations":
        args.stale.betaInvitations = true;
        break;
      case "--include-stale-invitations":
        args.stale.invitations = true;
        break;
      case "--include-expired-reset-tokens":
        args.stale.expiredResetTokens = true;
        break;
      case "--include-consumed-email-changes":
        args.stale.consumedEmailChanges = true;
        break;
      case "--access-request-ids":
        args.accessRequestIds.push(...splitIds(next()));
        break;
      case "--feedback-ids":
        args.feedbackIds.push(...splitIds(next()));
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function parseCutoffDays(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`--cutoff-days must be a non-negative integer, got "${raw}"`);
  }
  return n;
}

function splitIds(raw: string): string[] {
  return raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Refuse a plan that would delete a keep-listed user account. (Keep-listed
 * users MAY lose data belonging to a deleted tenant — that's expected — but
 * their User row must survive.) Returns offending user ids, empty when safe.
 */
export function keepListViolations(
  plan: CleanupOp[],
  keepUserIds: string[]
): string[] {
  const keep = new Set(keepUserIds);
  const userDelete = plan.find((op) => op.kind === "delete" && op.model === "User");
  if (!userDelete) return [];
  return userDelete.ids.filter((id) => keep.has(id));
}

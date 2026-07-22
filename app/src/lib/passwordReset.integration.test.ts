import { describe, it, expect, afterEach } from "vitest";
import { randomBytes, createHash } from "node:crypto";
import bcrypt from "bcrypt";
import { prisma } from "./prisma";
import { createPasswordResetToken, resetPassword } from "./passwordReset";

/**
 * Real-Postgres integration tests for the invariants that can only be proven
 * against a live database:
 *   - issuance: the DB-enforced "at most one ACTIVE (unused) token per user"
 *     partial unique index, under concurrency and on a second request;
 *   - consumption: the single transaction that claims the token, replaces the
 *     password, and bumps sessionVersion, including concurrent double-use.
 *
 * Consumption tests seed the token row directly from a `randomBytes` source
 * (not from createPasswordResetToken). That's deliberate: routing a
 * createPasswordResetToken *return value* into the SHA-256 hashToken sink
 * in-process trips a CodeQL false positive (it mislabels the high-entropy token
 * as a password). Production never creates that flow — the token leaves via
 * email and returns as a URL param. Seeding from randomBytes exercises the exact
 * same consumption path without the phantom taint.
 *
 * Gated behind INTEGRATION_DB so the DB-less "Unit Tests" job (which runs every
 * app/src test) skips them; the CI "Integration Tests" job sets INTEGRATION_DB
 * and provisions Postgres + migrations. Run locally with:
 *   INTEGRATION_DB=true npm run test:integration
 * The test names contain "integration" so `--testNamePattern integration`
 * selects them.
 */
const runDb = process.env.INTEGRATION_DB === "true";

const PLACEHOLDER_HASH = "placeholder-hash-not-a-real-password";
const BCRYPT_COST = 12;
const OLD_PASSWORD = "old-smoke-passphrase";

describe.skipIf(!runDb)("passwordReset [integration]", () => {
  const createdUserIds: string[] = [];

  async function makeUser(passwordHash: string = PLACEHOLDER_HASH) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const user = await prisma.user.create({
      data: {
        email: `reset-int-${suffix}@example.test`,
        displayName: "Reset Integration",
        passwordHash,
        sessionVersion: 0,
      },
    });
    createdUserIds.push(user.id);
    return user;
  }

  // Insert an active reset-token row directly, sourcing the raw token from
  // randomBytes (see the file header for why this avoids the CodeQL FP).
  async function seedActiveToken(userId: string) {
    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    await prisma.passwordResetToken.create({
      data: { userId, tokenHash, expiresAt: new Date(Date.now() + 3600_000) },
    });
    return rawToken;
  }

  afterEach(async () => {
    // Scoped cleanup: only the rows this suite created.
    if (createdUserIds.length === 0) return;
    await prisma.passwordResetToken.deleteMany({
      where: { userId: { in: createdUserIds } },
    });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdUserIds.length = 0;
  });

  it("integration: concurrent issuance leaves exactly one active token", async () => {
    const user = await makeUser();

    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => createPasswordResetToken(user.id))
    );

    // No call rejects: the losing racers resolve as { created: false } rather
    // than surfacing the unique violation.
    for (const r of results) {
      expect(r.status).toBe("fulfilled");
    }
    const createdCount = results.filter(
      (r) => r.status === "fulfilled" && r.value.created
    ).length;
    expect(createdCount).toBeGreaterThanOrEqual(1);

    // The invariant: no matter how the racers interleaved, exactly one active
    // (unused) token survives.
    const active = await prisma.passwordResetToken.count({
      where: { userId: user.id, usedAt: null },
    });
    expect(active).toBe(1);
  });

  it("integration: a second request invalidates the first, leaving one active token", async () => {
    const user = await makeUser();

    const first = await createPasswordResetToken(user.id);
    const second = await createPasswordResetToken(user.id);
    expect(first.created).toBe(true);
    expect(second.created).toBe(true);

    // Inspect DB state rather than re-hashing the raw tokens. Both requests
    // persisted a row, but the second consumed the first, so exactly one active
    // token remains. (If the second hadn't invalidated the first, both would be
    // unused.) Assert on counts to avoid depending on createdAt tie-breaks.
    const total = await prisma.passwordResetToken.count({
      where: { userId: user.id },
    });
    const active = await prisma.passwordResetToken.count({
      where: { userId: user.id, usedAt: null },
    });
    expect(total).toBe(2);
    expect(active).toBe(1);
  });

  it("integration: consuming a token replaces the password, bumps sessionVersion, and burns it", async () => {
    const oldHash = await bcrypt.hash(OLD_PASSWORD, BCRYPT_COST);
    const user = await makeUser(oldHash);
    const rawToken = await seedActiveToken(user.id);

    const result = await resetPassword(rawToken, "brand-new-passphrase");
    expect(result.status).toBe("success");

    const after = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    // Every session-carried JWT is now stale.
    expect(after.sessionVersion).toBe(1);
    // The stored hash is the NEW password, not the old one.
    expect(await bcrypt.compare("brand-new-passphrase", after.passwordHash ?? "")).toBe(
      true
    );
    expect(await bcrypt.compare(OLD_PASSWORD, after.passwordHash ?? "")).toBe(
      false
    );

    // Single-use: the same link can't be replayed.
    const reuse = await resetPassword(rawToken, "yet-another-passphrase");
    expect(reuse.status).toBe("invalid_token");
    const afterReuse = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(afterReuse.sessionVersion).toBe(1); // no second bump
  });

  it("integration: concurrent double-use of one link lets exactly one reset win", async () => {
    const oldHash = await bcrypt.hash(OLD_PASSWORD, BCRYPT_COST);
    const user = await makeUser(oldHash);
    const rawToken = await seedActiveToken(user.id);

    // Two requests race to consume the SAME link. The guarded single-use claim
    // (updateMany ... WHERE usedAt IS NULL, count must be 1) must let exactly one
    // through under real Postgres row-locking.
    const [a, b] = await Promise.all([
      resetPassword(rawToken, "concurrent-pass-one"),
      resetPassword(rawToken, "concurrent-pass-two"),
    ]);

    expect([a.status, b.status].sort()).toEqual(["invalid_token", "success"]);

    const after = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(after.sessionVersion).toBe(1); // exactly one successful reset
  });
});

import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "./prisma";
import {
  createPasswordResetToken,
  isValidPasswordResetToken,
  resetPassword,
} from "./passwordReset";

/**
 * Real-Postgres integration tests for the password-reset invariants that can
 * only be proven against a live database: the DB-enforced "one active token per
 * user" partial unique index (under concurrency), single-use, and the
 * session-version bump.
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

describe.skipIf(!runDb)("passwordReset [integration]", () => {
  const createdUserIds: string[] = [];

  async function makeUser() {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const user = await prisma.user.create({
      data: {
        email: `reset-int-${suffix}@example.test`,
        displayName: "Reset Integration",
        passwordHash: PLACEHOLDER_HASH,
        sessionVersion: 0,
      },
    });
    createdUserIds.push(user.id);
    return user;
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

  it("integration: a second request invalidates the first link", async () => {
    const user = await makeUser();

    const first = await createPasswordResetToken(user.id);
    const second = await createPasswordResetToken(user.id);
    if (!first.created || !second.created) {
      throw new Error("expected both sequential requests to create tokens");
    }

    expect(await isValidPasswordResetToken(first.rawToken)).toBe(false);
    expect(await isValidPasswordResetToken(second.rawToken)).toBe(true);
  });

  it("integration: a successful reset bumps sessionVersion and burns the token", async () => {
    const user = await makeUser();
    const created = await createPasswordResetToken(user.id);
    if (!created.created) throw new Error("expected a token to be created");

    const result = await resetPassword(created.rawToken, "a-brand-new-passphrase");
    expect(result.status).toBe("success");

    const after = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(after.sessionVersion).toBe(1); // revoked all prior sessions
    expect(after.passwordHash).not.toBe(PLACEHOLDER_HASH);

    // Single-use: the same link can't be replayed.
    const reuse = await resetPassword(created.rawToken, "yet-another-passphrase");
    expect(reuse.status).toBe("invalid_token");
  });
});

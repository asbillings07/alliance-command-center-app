import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "./prisma";
import { createPasswordResetToken } from "./passwordReset";

/**
 * Real-Postgres integration tests for the password-reset invariant that can
 * only be proven against a live database: the DB-enforced "at most one ACTIVE
 * (unused) token per user" partial unique index, including under concurrency.
 *
 * The single-use / session-revocation / expiry behaviours of resetPassword()
 * are covered by the unit suite (mocked Prisma) and by the production smoke
 * canaries; they're deliberately NOT re-tested here, because feeding a token
 * returned from createPasswordResetToken() back into the SHA-256 hashToken sink
 * in-process trips a CodeQL false positive (it mislabels the high-entropy token
 * as a low-entropy password). Production never creates that in-process flow: the
 * token leaves via email and returns as a URL param.
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
});

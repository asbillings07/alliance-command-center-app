import type { Prisma, PrismaClient } from "@/app/generated/prisma/client";

/**
 * Opens a real Prisma interactive transaction and keeps it uncommitted until
 * `commit()` is explicitly called, so a test can assert what a *second*,
 * concurrent connection sees/does while the first transaction still holds
 * its locks - the only way to prove a row-lock-based serialization claim
 * (like the #287 database design's §4c `FOR SHARE` fix) against a real
 * PostgreSQL instance rather than assuming it from documentation.
 *
 * `work` runs inside the held transaction and its return value is available
 * via the returned `ready` promise as soon as `work` resolves - at that
 * point `work`'s statements have executed and their locks are held, but the
 * transaction has not yet committed. Call `commit()` to let the underlying
 * `$transaction` call return, then await `committed` to know it actually has.
 */
export function heldTransaction<T>(
  prisma: PrismaClient,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): { ready: Promise<T>; commit: () => void; committed: Promise<void> } {
  let releaseHold = () => {};
  const hold = new Promise<void>((resolve) => {
    releaseHold = resolve;
  });

  let readyResolve!: (value: T) => void;
  let readyReject!: (reason: unknown) => void;
  const ready = new Promise<T>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });

  const committed = prisma
    .$transaction(
      async (tx) => {
        try {
          const value = await work(tx);
          readyResolve(value);
        } catch (err) {
          readyReject(err);
          throw err;
        }
        await hold;
      },
      // Real wall-clock time can pass between `ready` resolving and the test
      // calling `commit()`; the default interactive-transaction timeout
      // would otherwise abort the held transaction out from under the test.
      { timeout: 30_000, maxWait: 30_000 },
    )
    .then(() => undefined);

  return { ready, commit: releaseHold, committed };
}

/** Waits briefly and asserts a promise has not yet settled - the only way to
 * observe "still blocked on a database lock" from outside the connection
 * that holds it. */
export async function expectStillBlocked(promise: Promise<unknown>, waitMs = 500): Promise<void> {
  let settled = false;
  promise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await new Promise((resolve) => setTimeout(resolve, waitMs));
  if (settled) {
    throw new Error("Expected the operation to still be blocked, but it already settled");
  }
}

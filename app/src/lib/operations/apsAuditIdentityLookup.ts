/**
 * Standalone, DB-connection-free target-identity resolution for the APS
 * audit's operator-local identity lookup (#284 PR A review).
 *
 * Deliberately imports NOTHING beyond `productionDb.ts` (itself a
 * dependency-free module -- no imports at all), not the Prisma client, not
 * `betaParticipantBackfillDb.ts`, not any audit module. This is a structural
 * guarantee, not a convention: this module's import graph cannot construct
 * or connect a database client, regardless of what changes elsewhere in the
 * app, because there is nothing in that graph capable of doing so.
 *
 * `scripts/show-aps-audit-target-identity.ts` is the only caller, and is
 * equally minimal -- see its module doc comment for why identity lookup is
 * a wholly separate script from the audit CLI, rather than a flag on it.
 */
import { connectionIdentity } from "@/app/src/lib/productionDb";

export function resolveApsAuditTargetIdentity(env: Record<string, string | undefined> = process.env): string {
  const dbUrl = env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error("DATABASE_URL is required.");
  }
  return connectionIdentity(dbUrl);
}

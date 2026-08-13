import "server-only";
import { prisma } from "@/app/src/lib/prisma";

/**
 * The most recent member import for this alliance, or null when none has
 * ever been run. `rolledBack` is derived from the optional-to-one
 * `MemberImportRollback` relation (at most one committed rollback per
 * import, ever — see `MemberImport.rollback`'s own doc comment) rather than
 * a separate status field, so this can never drift from the rollback
 * record that is the actual source of truth.
 */
export type RosterHealthLatestImport = {
  id: string;
  createdAt: Date;
  createdCount: number;
  restoredCount: number;
  rolledBack: boolean;
};

export type RosterHealthSummary = {
  activeCount: number;
  archivedCount: number;
  latestImport: RosterHealthLatestImport | null;
};

/**
 * Roster health summary for the alliance dashboard's "Roster health" group
 * (#192/#332 phase 1). Every query is scoped directly by `allianceId` in its
 * own `where` clause (never a join-only or caller-trusted scope) — `allianceId`
 * must come from the caller's already-verified `requireAllianceAccess`
 * context, never from client input.
 */
export async function getRosterHealthSummary(allianceId: string): Promise<RosterHealthSummary> {
  if (!allianceId) {
    throw new Error("allianceId is required");
  }

  const [activeCount, archivedCount, latestImport] = await Promise.all([
    prisma.allianceMember.count({ where: { allianceId, archivedAt: null } }),
    prisma.allianceMember.count({ where: { allianceId, archivedAt: { not: null } } }),
    prisma.memberImport.findFirst({
      where: { allianceId },
      // `id` is a tiebreaker for imports sharing the same `createdAt` -
      // matches the composite index comment on MemberImport in schema.prisma
      // - so "latest" stays deterministic rather than depending on
      // whatever order Postgres happens to return equal-timestamp rows in.
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        createdAt: true,
        createdCount: true,
        restoredCount: true,
        rollback: { select: { id: true } },
      },
    }),
  ]);

  return {
    activeCount,
    archivedCount,
    latestImport: latestImport
      ? {
          id: latestImport.id,
          createdAt: latestImport.createdAt,
          createdCount: latestImport.createdCount,
          restoredCount: latestImport.restoredCount,
          rolledBack: latestImport.rollback !== null,
        }
      : null,
  };
}

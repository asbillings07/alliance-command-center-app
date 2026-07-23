import { prisma } from "@/app/src/lib/prisma";
import type { Prisma } from "@/app/generated/prisma/client";

/**
 * Executes a callback inside a Prisma transaction while holding an exclusive
 * row lock on the Alliance record (SELECT ... FOR UPDATE).
 * Passes the transaction client and current active member count to the callback,
 * allowing the callback to perform authoritative domain checks and enforce capacity
 * under the lock.
 */
export async function withAllianceMemberLock<T>(
    allianceId: string,
    fn: (tx: Prisma.TransactionClient, activeMembersCount: number) => Promise<T>
): Promise<T> {
    return await prisma.$transaction(async (tx) => {
        // 1. Acquire pessimistic row lock on the Alliance record to serialize active member capacity mutations
        await tx.$executeRaw`SELECT id FROM "Alliance" WHERE id = ${allianceId} FOR UPDATE`;

        // 2. Count current active members inside the transaction under the lock
        const activeMembersCount = await tx.allianceMember.count({
            where: { allianceId, archivedAt: null },
        });

        return await fn(tx, activeMembersCount);
    });
}

/**
 * Backwards compatibility alias for withAllianceMemberLock.
 */
export const withAllianceMemberCapacityLock = withAllianceMemberLock;

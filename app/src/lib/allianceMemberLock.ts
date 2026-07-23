import { prisma } from "@/app/src/lib/prisma";
import type { Prisma } from "@/app/generated/prisma/client";

/**
 * Executes a callback inside a Prisma transaction while holding an exclusive
 * row lock on the Alliance record (SELECT ... FOR UPDATE).
 * Re-counts active members inside the transaction and enforces that
 * (currentActiveCount + countToAdd) <= 100.
 */
export async function withAllianceMemberCapacityLock<T>(
    allianceId: string,
    countToAdd: number,
    fn: (tx: Prisma.TransactionClient, currentActiveCount: number) => Promise<T>
): Promise<T> {
    return await prisma.$transaction(async (tx) => {
        // 1. Acquire pessimistic row lock on the Alliance record to serialize active member capacity mutations
        await tx.$executeRaw`SELECT id FROM "Alliance" WHERE id = ${allianceId} FOR UPDATE`;

        // 2. Count current active members inside the transaction
        const currentActiveCount = await tx.allianceMember.count({
            where: { allianceId, archivedAt: null },
        });

        // 3. Enforce the 100 active member capacity invariant
        if (currentActiveCount + countToAdd > 100) {
            const available = Math.max(0, 100 - currentActiveCount);
            const overflow = (currentActiveCount + countToAdd) - 100;
            throw new Error(
                `Your alliance has ${currentActiveCount} active members, so you can add ${available} more. You currently have ${countToAdd} members selected. Deselect ${overflow} member${overflow === 1 ? "" : "s"} to continue.`
            );
        }

        return await fn(tx, currentActiveCount);
    });
}

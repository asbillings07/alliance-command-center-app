/**
 * Shared active-member capacity policy for the roster domain (#277 PR 2).
 *
 * Every alliance is capped at `MAX_ACTIVE_ALLIANCE_MEMBERS` *active*
 * (non-archived) AllianceMember rows — archiving doesn't delete a member, so
 * archived history can grow without bound, but the active roster cannot.
 * This module is deliberately dependency-free (no Prisma import) so it can
 * run in both Server Actions (the authoritative check, always re-verified
 * inside `withAllianceMemberLock`) and Client Components (pre-flight UX math
 * — e.g. a confirmation dialog showing "Active roster: 91 → 98; 2 spaces
 * remaining" before the user submits).
 *
 * Previously this constant and its error message were duplicated as a
 * literal `100` across member-actions.ts, members/new/action.ts,
 * inviteLeadershipCollaborator.ts, and the roster import action/form. This
 * module is the single source of truth going forward.
 */
export const MAX_ACTIVE_ALLIANCE_MEMBERS = 100;

/**
 * How many more members can become/stay active without exceeding the cap.
 * Never negative — an alliance already at or over the cap (e.g. after a
 * cap decrease) simply has zero available capacity, not a negative one.
 */
export function getAvailableMemberCapacity(activeCount: number): number {
    return Math.max(0, MAX_ACTIVE_ALLIANCE_MEMBERS - activeCount);
}

export type MemberCapacityAction = "add" | "restore";

/**
 * Returns a user-facing error message if bulk-adding/restoring
 * `requestedCount` *selected* members would push the alliance over its
 * active-member cap, or `null` if there's enough room.
 *
 * This is for flows with an actual selection UI (checkboxes) — the message
 * tells the user how many of their selections to deselect. Single-item
 * flows (add one member, restore one member, invite one collaborator) have
 * no selection to change; use `getSingleMemberCapacityError` for those so
 * the copy doesn't ask the user to do something the UI doesn't offer.
 *
 * `requestedCount` should be the count of members that would *actually*
 * transition into the active set — for a bulk restore, that means only the
 * still-archived subset of the current selection (a member someone else
 * already restored moments ago needs no new capacity and shouldn't count
 * against this check).
 */
export function getBulkMemberCapacityError(
    activeCount: number,
    requestedCount: number,
    action: MemberCapacityAction
): string | null {
    const available = getAvailableMemberCapacity(activeCount);
    if (requestedCount <= available) {
        return null;
    }

    const verb = action === "add" ? "add" : "restore";
    const deselectCount = requestedCount - available;
    return (
        `Your alliance has ${activeCount} active members, so you can ${verb} ${available} more. ` +
        `You currently have ${requestedCount} member${requestedCount === 1 ? "" : "s"} selected. ` +
        `Deselect ${deselectCount} member${deselectCount === 1 ? "" : "s"} to continue.`
    );
}

/**
 * Returns a user-facing error message if adding/restoring a single member
 * would push the alliance over its active-member cap, or `null` if there's
 * room for one more.
 *
 * For single-item flows with no selection UI: adding a member, restoring a
 * member from a detail page, or inviting a leadership collaborator (which
 * also occupies an active-member slot). Deliberately omits
 * `getBulkMemberCapacityError`'s "selected"/"deselect" language, which would
 * describe a UI action the user can't actually take here.
 */
export function getSingleMemberCapacityError(
    activeCount: number,
    action: MemberCapacityAction
): string | null {
    const available = getAvailableMemberCapacity(activeCount);
    if (available >= 1) {
        return null;
    }

    const verb = action === "add" ? "add" : "restore";
    return `Your alliance has ${activeCount} active members, so you can ${verb} ${available} more.`;
}

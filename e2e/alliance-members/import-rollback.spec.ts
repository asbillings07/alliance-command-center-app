import { test, expect } from "../shared/fixtures";
import { prisma } from "@/app/src/lib/prisma";
import { MemberImportChangeType } from "@/app/generated/prisma/enums";

/**
 * Import Rollback (Undo Import) E2E Tests (#277 PR 3)
 *
 * Route-level evidence for the dedicated undo route: Owner-only access,
 * server-computed preview, no-preselection conflict resolution, the shared
 * confirmation dialog for the final commit, and the durable result summary
 * on revisit.
 */

async function seedCreatedImport(allianceId: string, playerName: string) {
    const member = await prisma.allianceMember.create({
        data: { allianceId, playerName, thp: 1000, role: "Member" },
    });
    const memberImport = await prisma.memberImport.create({
        data: {
            allianceId,
            actorEmailSnapshot: "importer@example.com",
            fileName: "e2e-roster.xlsx",
            sourceSheetName: "Sheet1",
            createdCount: 1,
            restoredCount: 0,
            skippedExistingCount: 0,
            skippedDuplicateCount: 0,
            skippedEmptyNameCount: 0,
            skippedUnselectedCount: 0,
            changes: {
                create: [
                    {
                        allianceMemberId: member.id,
                        playerNameSnapshot: member.playerName,
                        sourceRow: 1,
                        changeType: MemberImportChangeType.CREATED,
                        archivedAtBefore: null,
                        archivedAtAfter: null,
                        thpBefore: null,
                        thpAfter: member.thp,
                        roleBefore: null,
                        roleAfter: member.role,
                        discordNameAfter: member.discordName,
                        squadPowerAfter: member.squadPower,
                        joinedAtAfter: member.joinedAt,
                        userIdAfter: member.userId,
                        memberUpdatedAtAfter: member.updatedAt,
                    },
                ],
            },
        },
        select: { id: true },
    });
    return { memberId: member.id, memberImportId: memberImport.id };
}

test.describe("Import Rollback", () => {
    test("Owner sees the Undo import link on the detail page; the undo page cleanly deletes a clean CREATED member", async ({
        page,
        login,
        ownerScenario,
    }) => {
        const { allianceId, email, password } = ownerScenario;
        const { memberId, memberImportId } = await seedCreatedImport(allianceId, "RollbackCleanCreate");

        await login({ email, password, displayName: "Owner User" });

        await page.goto(`/alliances/${allianceId}/members/imports/${memberImportId}`);
        const undoLink = page.getByRole("link", { name: "Undo import" });
        await expect(undoLink).toBeVisible();
        await undoLink.click();

        await page.waitForURL(`**/members/imports/${memberImportId}/undo`);
        await expect(page.getByText("Delete (undo creation)")).toBeVisible();

        await page.getByRole("button", { name: "Undo this import" }).click();
        const dialog = page.getByRole("dialog");
        await expect(dialog.getByText("Undo this import?")).toBeVisible();
        await expect(dialog.getByText("1 member will be deleted.")).toBeVisible();
        await dialog.getByRole("button", { name: "Undo import" }).click();

        await expect(page.getByText("This import was fully undone.")).toBeVisible();
        await expect(page.getByText("1 member deleted")).toBeVisible();

        const stillExists = await prisma.allianceMember.findUnique({ where: { id: memberId } });
        expect(stillExists).toBeNull();
    });

    test("requires an explicit choice for a conflicting CREATED member before allowing the owner to confirm", async ({
        page,
        login,
        ownerScenario,
    }) => {
        const { allianceId, email, password } = ownerScenario;
        const { memberId, memberImportId } = await seedCreatedImport(allianceId, "RollbackConflictMember");

        // A real edit lands after the import.
        await prisma.allianceMember.update({ where: { id: memberId }, data: { thp: 9999 } });

        await login({ email, password, displayName: "Owner User" });
        await page.goto(`/alliances/${allianceId}/members/imports/${memberImportId}/undo`);

        const keepActiveRadio = page.getByRole("radio", { name: "Keep active" });
        const archiveRadio = page.getByRole("radio", { name: "Archive and preserve history" });
        await expect(keepActiveRadio).not.toBeChecked();
        await expect(archiveRadio).not.toBeChecked();

        const confirmTrigger = page.getByRole("button", { name: "Undo this import" });
        await expect(confirmTrigger).toBeDisabled();

        await archiveRadio.check();
        await expect(confirmTrigger).toBeEnabled();

        await confirmTrigger.click();
        await page.getByRole("dialog").getByRole("button", { name: "Undo import" }).click();

        await expect(page.getByText("undone, but some members were retained")).toBeVisible();

        const member = await prisma.allianceMember.findUniqueOrThrow({ where: { id: memberId } });
        expect(member.archivedAt).not.toBeNull();
        expect(member.thp).toBe(9999); // preserved, never reverted

        // The durable view (post-reload) must explain *why* this row wasn't
        // auto-rolled-back, not just report the resolution it got — the
        // exact evidence MemberImportRollbackResult persisted, not a
        // generic "conflict" label.
        await page.reload();
        await expect(page.getByText("Changed since import: thp")).toBeVisible();
    });

    test("revisiting the undo URL after completion shows the durable result instead of the interactive form again", async ({
        page,
        login,
        ownerScenario,
    }) => {
        const { allianceId, email, password } = ownerScenario;
        const { memberImportId } = await seedCreatedImport(allianceId, "RollbackDurableView");

        await login({ email, password, displayName: "Owner User" });
        await page.goto(`/alliances/${allianceId}/members/imports/${memberImportId}/undo`);
        await page.getByRole("button", { name: "Undo this import" }).click();
        await page.getByRole("dialog").getByRole("button", { name: "Undo import" }).click();
        await expect(page.getByText("This import was fully undone.")).toBeVisible();

        await page.reload();
        await expect(page.getByText("This import was fully undone.")).toBeVisible();
        await expect(page.getByRole("button", { name: "Undo this import" })).not.toBeVisible();
    });

    test("a non-Owner cannot see the Undo import link and is redirected away from the undo page directly", async ({
        page,
        login,
        adminScenario,
    }) => {
        const { allianceId, email, password } = adminScenario;
        const { memberImportId } = await seedCreatedImport(allianceId, "RollbackAdminDenied");

        await login({ email, password, displayName: "Admin User" });

        await page.goto(`/alliances/${allianceId}/members/imports/${memberImportId}`);
        await expect(page.getByRole("link", { name: "Undo import" })).not.toBeVisible();

        await page.goto(`/alliances/${allianceId}/members/imports/${memberImportId}/undo`);
        await page.waitForURL((url) => !url.pathname.includes("/undo"));
        expect(page.url()).not.toContain("/undo");
    });
});

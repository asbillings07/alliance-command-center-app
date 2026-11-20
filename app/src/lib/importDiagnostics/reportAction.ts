"use server";

import { auth } from "../auth";
import { buildPermissionSet } from "../auth/permissions";
import { readClientBuild } from "../ocr/clientBuild";
import { prisma } from "../prisma";
import { reasons, workflows, type Reason, type Workflow } from "./codes";

export async function reportImportError(allianceId: string, workflow: Workflow, code: Reason, build?: string, requestId?: string) {
  if (typeof allianceId !== "string" || !allianceId || allianceId.length > 96 ||
      typeof workflow !== "string" || !Object.hasOwn(workflows, workflow) ||
      typeof code !== "string" || !Object.hasOwn(reasons, code)) return;
  const scanRequestId = workflow === "screenshot" && code === "scan_unconfirmed" &&
    typeof requestId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId) ? requestId : null;
  const actorId = (await auth())?.user?.id;
  if (!actorId) return;
  const membership = await prisma.allianceMembership.findUnique({
      where: { allianceId_userId: { allianceId, userId: actorId } }, select: { role: true },
    });
  const permissions = membership && buildPermissionSet(membership.role);
  const allowed = workflow === "roster" || workflow === "historical" ? permissions?.canImportMembers : permissions?.canImportMetrics;
  if (!allowed) {
    if (workflow !== "screenshot") return;
    // Approved members can use the individual screenshot path without a leadership role.
    const { authorizeScreenshotUpload } = await import("../ocr/evaluation");
    try { await authorizeScreenshotUpload({ allianceId, actorId, memberId: null }); } catch { return; }
  }
  await prisma.$transaction(async tx => {
    // Bound concurrent client reports without delaying or retrying the original import.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${actorId}, 421))`;
    const recent = await tx.importErrorReport.count({ where: { actorId, createdAt: { gte: new Date(Date.now() - 60000) } } });
    if (recent < 60) await tx.importErrorReport.create({ data: { allianceId, actorId, workflow, code, scanRequestId, clientBuild: readClientBuild(build) } });
  });
}

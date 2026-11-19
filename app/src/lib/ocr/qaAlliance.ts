import "server-only";
import { Prisma, type AllianceRole } from "@/app/generated/prisma/client";
import { prisma } from "../prisma";
import { buildPermissionSet } from "../auth/permissions";
import { touchAllianceSetupActivity } from "../touchAllianceSetupActivity";
import { localOcrFixtureEnabled, OcrEvaluationError, requireOcrEvaluation } from "./config";
import { requireOcrRollout } from "./rollout";
import { checkOcrDeploymentIsolation, isLocalOcrDatabase } from "./deploymentIsolation";

/** The QA name editor may never run against an ordinary preview or live DB. */
export function requireQaAllianceEditing(allianceId: string) {
  requireOcrEvaluation(allianceId);
  if (localOcrFixtureEnabled()) {
    if (isLocalOcrDatabase(process.env.DATABASE_URL)) return;
  } else if (checkOcrDeploymentIsolation(process.env).length === 0) return;
  throw new OcrEvaluationError("QA alliance editing is available only in the isolated test database.");
}

export function validateQaAllianceName(value: string) {
  const name = value.trim();
  if (!name || name.length > 200 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new OcrEvaluationError("Enter an alliance name between 1 and 200 characters, on one line.");
  }
  return name;
}

async function authorize(tx: Prisma.TransactionClient, allianceId: string, actorId: string) {
  const [actor] = await tx.$queryRaw<{ id: string; displayName: string; role: AllianceRole; allianceId: string }[]>`
    SELECT u."id", u."displayName", m."role", m."allianceId" FROM "AllianceMembership" m
    JOIN "User" u ON u."id" = m."userId"
    WHERE m."allianceId" = ${allianceId} AND m."userId" = ${actorId} FOR SHARE OF m, u`;
  // This is isolated trial setup, not the production alliance-management grant.
  if (!actor || !buildPermissionSet(actor.role).canImportMetrics) {
    throw new OcrEvaluationError("Only this test alliance's authorized importers can change its QA name.");
  }
  await requireOcrRollout({ userId: actor.id, allianceId: actor.allianceId });
  return actor;
}

export async function loadQaAllianceSettings(allianceId: string, actorId: string) {
  requireQaAllianceEditing(allianceId);
  return prisma.$transaction(async tx => {
    await authorize(tx, allianceId, actorId);
    const alliance = await tx.alliance.findUniqueOrThrow({ where: { id: allianceId }, select: { name: true, server: true, identityVersion: true } });
    const history = await tx.ocrQaAllianceNameChange.findMany({ where: { allianceId }, orderBy: { id: "desc" }, take: 20 });
    return { ...alliance, history: history.map(change => ({ id: change.id, previousName: change.previousName, name: change.name,
      actorName: change.actorName, createdAt: change.createdAt.toISOString() })) };
  });
}

export async function renameQaAlliance(input: { allianceId: string; actorId: string; name: string; identityVersion: number; acknowledged: boolean }) {
  requireQaAllianceEditing(input.allianceId);
  if (!input.acknowledged) throw new OcrEvaluationError("Review and confirm the QA name change first.");
  if (!Number.isSafeInteger(input.identityVersion) || input.identityVersion < 0) throw new OcrEvaluationError("Reload the QA settings before changing the name.");
  const name = validateQaAllianceName(input.name);
  try {
    return await prisma.$transaction(async tx => {
      const actor = await authorize(tx, input.allianceId, input.actorId);
      const [current] = await tx.$queryRaw<{ name: string; server: string; identityVersion: number }[]>`
        SELECT "name", "server", "identityVersion" FROM "Alliance" WHERE "id" = ${input.allianceId} FOR UPDATE`;
      if (!current || current.identityVersion !== input.identityVersion) throw new OcrEvaluationError("The QA alliance changed. Reload and review its current name before saving.");
      if (current.name === name) throw new OcrEvaluationError("The alliance name has not changed.");
      const updated = await tx.alliance.update({ where: { id: input.allianceId }, data: { name } });
      await touchAllianceSetupActivity(tx, input.allianceId);
      await tx.ocrQaAllianceNameChange.create({ data: { allianceId: input.allianceId, previousName: current.name, name,
        server: current.server, allianceVersion: updated.identityVersion, actorUserId: actor.id, actorName: actor.displayName } });
      return { name: updated.name };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10_000 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") throw new OcrEvaluationError("Another test alliance already uses that name on this server.");
      if (error.code === "P2034") throw new OcrEvaluationError("The QA alliance changed while saving. Reload and review it before trying again.");
    }
    throw error;
  }
}

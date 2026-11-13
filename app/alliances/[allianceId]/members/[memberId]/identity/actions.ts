"use server";

import { revalidatePath } from "next/cache";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { Permissions } from "@/app/src/lib/auth/permissions";
import { decideMemberIdentity, correctMemberIdentityName, IdentityReviewError } from "@/app/src/lib/memberIdentity";

export async function saveIdentityDecision(allianceId: string, memberId: string,
  input: { reviewKey: string; confirm: boolean; acknowledged: boolean },
): Promise<{ ok: boolean; message: string }> {
  const { user } = await requireAllianceAccess({ allianceId, requiredPermission: Permissions.MANAGE_MEMBER_IDENTITY });
  if (!input || typeof input.reviewKey !== "string" || typeof input.confirm !== "boolean" || input.acknowledged !== true) {
    return { ok: false, message: "Review the identity details and confirm your decision." };
  }
  try {
    await decideMemberIdentity({ allianceId, memberId, actorId: user.id,
      reviewKey: input.reviewKey, confirm: input.confirm, acknowledged: input.acknowledged });
  } catch (error) {
    if (error instanceof IdentityReviewError) return { ok: false, message: error.message };
    console.error("[member-identity] Decision could not be completed", { allianceId, memberId });
    return { ok: false, message: "The outcome could not be confirmed. Reload and check the decision history before trying again." };
  }
  revalidatePath(`/alliances/${allianceId}/members/${memberId}/identity`);
  return { ok: true, message: input.confirm ? "Identity confirmed. Screenshot uploads remain unavailable." : "Confirmation revoked. The earlier decision remains in history." };
}

export async function saveIdentityName(allianceId: string, memberId: string,
  input: { reviewKey: string; playerName: string; acknowledged: boolean },
): Promise<{ ok: boolean; message: string }> {
  const { user } = await requireAllianceAccess({ allianceId, requiredPermission: Permissions.MANAGE_MEMBER_IDENTITY });
  if (!input || typeof input.reviewKey !== "string" || typeof input.playerName !== "string" || input.acknowledged !== true) {
    return { ok: false, message: "Review the name change and confirm your decision." };
  }
  try {
    await correctMemberIdentityName({ allianceId, memberId, actorId: user.id,
      reviewKey: input.reviewKey, playerName: input.playerName, acknowledged: input.acknowledged });
  } catch (error) {
    if (error instanceof IdentityReviewError) return { ok: false, message: error.message };
    console.error("[member-identity] Name change could not be confirmed", { allianceId, memberId });
    return { ok: false, message: "The outcome could not be confirmed. Reload and check the current name and identity history before trying again." };
  }
  revalidatePath(`/alliances/${allianceId}/members`);
  revalidatePath(`/alliances/${allianceId}/members/${memberId}`);
  revalidatePath(`/alliances/${allianceId}/members/${memberId}/identity`);
  revalidatePath(`/alliances/${allianceId}/reports`);
  revalidatePath("/alliances/[allianceId]/reports/metrics/[metricId]", "page");
  return { ok: true, message: "In-game name updated. Review and confirm the current identity before screenshot eligibility can be established." };
}

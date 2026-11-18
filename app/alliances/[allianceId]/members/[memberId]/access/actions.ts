"use server";
import { revalidatePath } from "next/cache";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { Permissions } from "@/app/src/lib/auth/permissions";
import { decideMemberSelfAccess, MemberAccessError } from "@/app/src/lib/memberSelfAccess";
import { IdentityReviewError } from "@/app/src/lib/memberIdentity";

export async function saveMemberAccess(allianceId: string, memberId: string,
  input: { reviewKey: string; grant: boolean; acknowledged: boolean },
): Promise<{ ok: boolean; message: string }> {
  const { user } = await requireAllianceAccess({ allianceId, requiredPermission: Permissions.MANAGE_MEMBERS });
  if (!input || typeof input.reviewKey !== "string" || typeof input.grant !== "boolean" || input.acknowledged !== true) {
    return { ok: false, message: "Review the access details and confirm your decision." };
  }
  try {
    await decideMemberSelfAccess({ allianceId, memberId, actorId: user.id,
      reviewKey: input.reviewKey, grant: input.grant, acknowledged: true });
  } catch (error) {
    if (error instanceof MemberAccessError || error instanceof IdentityReviewError) return { ok: false, message: error.message };
    console.error("[member-access] Decision could not be confirmed", { allianceId, memberId });
    return { ok: false, message: "The outcome could not be confirmed. Reload and check access history before trying again." };
  }
  revalidatePath(`/alliances/${allianceId}/members/${memberId}/access`);
  revalidatePath(`/alliances/${allianceId}/my-record`);
  revalidatePath("/alliances/my-records");
  revalidatePath("/app");
  return { ok: true, message: input.grant ? "Member access approved. Screenshot uploads remain unavailable." : "Member access revoked. Earlier decisions remain in history." };
}

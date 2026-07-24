import "server-only";
import { revalidatePath } from "next/cache";

export type InvalidationDomain =
  | "members"
  | "evaluation-results"
  | "setup"
  | "dashboard";

export type RevalidateAllianceDataParams = {
  allianceId: string;
  domains: readonly InvalidationDomain[];
  periodId?: string;
};

/**
  * Centralized domain cache invalidation helper for alliance data.
  *
  * Server actions declare which high-level domains changed rather than hardcoding
  * every current user-facing URL across the application.
  *
  * Domain Mappings:
  * - "members": Exact list page (/alliances/[id]/members) + member detail route pattern (/alliances/[allianceId]/members/[memberId])
  * - "evaluation-results": Period detail (/alliances/[id]/periods/[periodId]), record page, and import page
  * - "setup": Alliance onboarding setup checklist (/alliances/[id]/setup)
  * - "dashboard": Alliance overview dashboard (/alliances/[id])
  */
export function revalidateAllianceData(params: RevalidateAllianceDataParams): void {
  const { allianceId, domains, periodId } = params;

  if (!allianceId) {
    throw new Error("allianceId is required for revalidation");
  }

  if (domains.includes("evaluation-results") && !periodId) {
    throw new Error("periodId is required when invalidating evaluation results");
  }

  const domainsSet = new Set(domains);

  if (domainsSet.has("members")) {
    revalidatePath(`/alliances/${allianceId}/members`);
    revalidatePath("/alliances/[allianceId]/members/[memberId]", "page");
  }

  if (domainsSet.has("evaluation-results") && periodId) {
    revalidatePath(`/alliances/${allianceId}/periods/${periodId}`);
    revalidatePath(`/alliances/${allianceId}/periods/${periodId}/record`);
    revalidatePath(`/alliances/${allianceId}/periods/${periodId}/import`);
  }

  if (domainsSet.has("setup")) {
    revalidatePath(`/alliances/${allianceId}/setup`);
  }

  if (domainsSet.has("dashboard")) {
    revalidatePath(`/alliances/${allianceId}`);
  }
}

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
  * - "members": Layout invalidation for the members subtree (/alliances/[id]/members), including list and detail pages
  * - "evaluation-results": Period detail (/alliances/[id]/periods/[periodId]) and record page (/alliances/[id]/periods/[periodId]/record)
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

  const pathsToRevalidate = new Map<string, "page" | "layout">();

  for (const domain of domains) {
    switch (domain) {
      case "members":
        pathsToRevalidate.set(`/alliances/${allianceId}/members`, "layout");
        break;
      case "evaluation-results":
        if (periodId) {
          pathsToRevalidate.set(`/alliances/${allianceId}/periods/${periodId}`, "page");
          pathsToRevalidate.set(`/alliances/${allianceId}/periods/${periodId}/record`, "page");
          pathsToRevalidate.set(`/alliances/${allianceId}/periods/${periodId}/import`, "page");
        }
        break;
      case "setup":
        pathsToRevalidate.set(`/alliances/${allianceId}/setup`, "page");
        break;
      case "dashboard":
        pathsToRevalidate.set(`/alliances/${allianceId}`, "page");
        break;
    }
  }

  for (const [path, type] of pathsToRevalidate.entries()) {
    revalidatePath(path, type);
  }
}

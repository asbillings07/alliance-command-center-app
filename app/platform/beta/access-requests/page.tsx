import Link from "next/link";
import { Suspense } from "react";
import { requirePlatformAdmin } from "@/app/src/lib/auth/requirePlatformAdmin";
import { listAccessRequestsForTriage } from "@/app/src/lib/platform/accessRequestInbox";
import { AccessRequestFilters } from "./AccessRequestFilters";
import { AccessRequestList } from "./AccessRequestList";
import { AccessRequestSummaryCards } from "./AccessRequestSummaryCards";
import {
  accessRequestFiltersToUrlState,
  parseAccessRequestPageParams,
  type AccessRequestPageSearchParams,
} from "./urlParams";

/**
 * Platform Access Request queue (#177).
 *
 * Discovered from the existing Beta page via an operational card rather
 * than a new top-level PlatformNav entry — see the "Beta / Access requests"
 * breadcrumb + "Back to Beta participants" link below, which keep the
 * Beta nav item active via PlatformNav's descendant-path handling without
 * any nav change (#177 design decision).
 */

type PageProps = {
  searchParams: Promise<AccessRequestPageSearchParams>;
};

export default async function AccessRequestsPage({ searchParams }: PageProps) {
  await requirePlatformAdmin();

  const params = await searchParams;
  const { filters, page, pageSize } = parseAccessRequestPageParams(params);
  const urlState = accessRequestFiltersToUrlState(filters, page, pageSize);

  const result = await listAccessRequestsForTriage(filters, page, pageSize);

  return (
    <div className="space-y-8 max-w-6xl" data-testid="platform-access-requests-page">
      <nav className="text-sm text-text-muted" aria-label="Breadcrumb">
        <Link href="/platform/beta" className="text-primary hover:text-primary-hover underline">
          Beta
        </Link>
        {" / "}
        <span className="text-text-secondary">Access requests</span>
      </nav>

      <section>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <h2 className="text-lg font-semibold text-text-secondary">Access Requests</h2>
          <Link
            href="/platform/beta"
            className="text-sm text-primary hover:text-primary-hover"
            data-testid="back-to-beta-participants"
          >
            ← Back to Beta participants
          </Link>
        </div>

        <AccessRequestSummaryCards statusCounts={result.statusCounts} urlState={urlState} />

        <Suspense fallback={<p className="text-sm text-text-muted">Loading filters…</p>}>
          <AccessRequestFilters
            key={JSON.stringify(urlState)}
            filters={filters}
            page={result.page}
            pageSize={result.pageSize}
            total={result.total}
          />
        </Suspense>
      </section>

      {result.items.length > 0 ? (
        <AccessRequestList items={result.items} />
      ) : (
        <div className="text-center py-12 text-text-muted">
          <p>No access requests match these filters.</p>
          <p className="text-sm mt-1">
            <Link href="/platform/beta/access-requests" className="text-primary hover:text-primary-hover">
              Clear filters
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}

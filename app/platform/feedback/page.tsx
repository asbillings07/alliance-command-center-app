import Link from "next/link";
import { Suspense } from "react";
import { requirePlatformAdmin } from "@/app/src/lib/auth/requirePlatformAdmin";
import {
  listFeedbackFilterOptions,
  listFeedbackForTriage,
} from "@/app/src/lib/platform/feedbackInbox";
import { FeedbackFilters } from "./FeedbackFilters";
import { FeedbackCard, FeedbackTableRow } from "./FeedbackList";
import { FeedbackSummaryCards } from "./FeedbackSummaryCards";
import { FeedbackInboxUnavailable } from "./FeedbackUnavailable";
import {
  feedbackFiltersToUrlState,
  parseFeedbackPageParams,
  type FeedbackPageSearchParams,
} from "./urlParams";

/**
 * Platform Feedback Inbox (#176)
 *
 * Operator workspace for triaging beta tester feedback.
 */

type PageProps = {
  searchParams: Promise<FeedbackPageSearchParams>;
};

export default async function PlatformFeedbackPage({ searchParams }: PageProps) {
  await requirePlatformAdmin();

  const params = await searchParams;
  const { filters, page, pageSize } = parseFeedbackPageParams(params);
  const urlState = feedbackFiltersToUrlState(filters, page, pageSize);

  let listResult;
  try {
    listResult = await listFeedbackForTriage(filters, page, pageSize);
  } catch {
    return (
      <div className="space-y-8 max-w-6xl" data-testid="platform-feedback-page">
        <section>
          <h2 className="text-lg font-semibold text-text-secondary mb-4">
            Feedback Inbox
          </h2>
          <FeedbackInboxUnavailable />
        </section>
      </div>
    );
  }

  const filterOptions = await listFeedbackFilterOptions();

  return (
    <div className="space-y-8 max-w-6xl" data-testid="platform-feedback-page">
      <section>
        <h2 className="text-lg font-semibold text-text-secondary mb-4">
          Feedback Inbox
        </h2>

        <FeedbackSummaryCards
          summary={listResult.summary}
          urlState={urlState}
        />

        <Suspense fallback={<p className="text-sm text-text-muted">Loading filters…</p>}>
          <FeedbackFilters
            filters={filters}
            allianceOptions={filterOptions.alliances}
            waveOptions={filterOptions.waves}
            page={listResult.page}
            pageSize={listResult.pageSize}
            total={listResult.total}
          />
        </Suspense>
      </section>

      {listResult.items.length > 0 ? (
        <section>
          <div className="md:hidden space-y-3">
            {listResult.items.map((item) => (
              <FeedbackCard key={item.feedbackId} item={item} />
            ))}
          </div>
          <div className="hidden md:block bg-surface rounded-lg border border-border overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 px-4 text-text-muted font-medium">
                    Feedback
                  </th>
                </tr>
              </thead>
              <tbody>
                {listResult.items.map((item) => (
                  <FeedbackTableRow key={item.feedbackId} item={item} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <div className="text-center py-12 text-text-muted">
          <p>No feedback matches these filters.</p>
          <p className="text-sm mt-1">
            <Link
              href="/platform/feedback"
              className="text-primary hover:text-primary-hover"
            >
              Clear filters
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}

import Link from "next/link";
import { Suspense } from "react";
import {
  listBetaParticipants,
  type BetaAttentionReason,
  type BetaJourneyStage,
  boundBetaParticipantsInput,
} from "@/app/src/lib/platform/betaParticipants";
import { InviteBetaTester } from "./InviteBetaTester";
import { ParticipantFilters } from "./ParticipantFilters";
import { ParticipantCard, ParticipantTableRow } from "./ParticipantList";

/**
 * Platform Beta Operations
 *
 * Participant-centric workspace for beta invitation lifecycle visibility.
 */

const VALID_JOURNEY_STAGES = new Set<BetaJourneyStage>([
  "invited",
  "accepted",
  "alliance_created",
  "roster_imported",
  "first_dataset_recorded",
  "setup_complete",
]);

const VALID_ATTENTION_REASONS = new Set<BetaAttentionReason>([
  "invitation_expired",
  "invitation_pending_stale",
  "accepted_no_alliance",
  "setup_stalled",
]);

type PageProps = {
  searchParams: Promise<{
    search?: string;
    wave?: string;
    journeyStage?: string;
    attentionReason?: string;
    page?: string;
    pageSize?: string;
  }>;
};

function parsePageParam(raw: string | undefined): number {
  const parsed = raw ? Number.parseInt(raw, 10) : 1;
  return Number.isFinite(parsed) ? parsed : 1;
}

function parsePageSizeParam(raw: string | undefined): number {
  const parsed = raw ? Number.parseInt(raw, 10) : 25;
  return Number.isFinite(parsed) ? parsed : 25;
}

export default async function PlatformBeta({ searchParams }: PageProps) {
  const params = await searchParams;
  const search = boundBetaParticipantsInput(params.search);
  const wave = boundBetaParticipantsInput(params.wave);
  const journeyStage = VALID_JOURNEY_STAGES.has(params.journeyStage as BetaJourneyStage)
    ? (params.journeyStage as BetaJourneyStage)
    : undefined;
  const attentionReason = VALID_ATTENTION_REASONS.has(
    params.attentionReason as BetaAttentionReason,
  )
    ? (params.attentionReason as BetaAttentionReason)
    : undefined;
  const page = parsePageParam(params.page);
  const pageSize = parsePageSizeParam(params.pageSize);

  const result = await listBetaParticipants(
    { search, wave, journeyStage, attentionReason },
    page,
    pageSize,
  );

  return (
    <div className="space-y-8 max-w-6xl">
      <section>
        <InviteBetaTester />
      </section>

      <section>
        <h2 className="text-lg font-semibold text-text-secondary mb-4">
          Beta Participants
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-surface-secondary rounded-lg p-4 border border-border">
            <div className="text-2xl font-bold text-text-primary">
              {result.summary.totalParticipants}
            </div>
            <div className="text-sm text-text-muted">Participants</div>
          </div>
          <div className="bg-warning/10 rounded-lg p-4 border border-warning/20">
            <div className="text-2xl font-bold text-warning">
              {result.summary.needsAttention}
            </div>
            <div className="text-sm text-warning/80">Needs attention</div>
          </div>
          <div className="bg-primary/10 rounded-lg p-4 border border-primary/20">
            <div className="text-2xl font-bold text-primary">
              {result.summary.distinctAlliancesCreated}
            </div>
            <div className="text-sm text-primary/80">Alliances created</div>
          </div>
          <div className="bg-success/10 rounded-lg p-4 border border-success/20">
            <div className="text-2xl font-bold text-success">
              {result.summary.distinctAlliancesSetupComplete}
            </div>
            <div className="text-sm text-success/80">Setup complete</div>
          </div>
        </div>

        <Suspense fallback={<p className="text-sm text-text-muted">Loading filters…</p>}>
          <ParticipantFilters
            search={search}
            wave={wave}
            journeyStage={journeyStage ?? ""}
            attentionReason={attentionReason ?? ""}
            page={result.page}
            pageSize={result.pageSize}
            total={result.total}
          />
        </Suspense>
      </section>

      {result.items.length > 0 ? (
        <section>
          <div className="md:hidden space-y-3">
            {result.items.map((item) => (
              <ParticipantCard key={item.participantId} item={item} />
            ))}
          </div>
          <div className="hidden md:block bg-surface rounded-lg border border-border overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 px-4 text-text-muted font-medium">
                    Participant
                  </th>
                  <th className="text-left py-3 px-4 text-text-muted font-medium">
                    Wave
                  </th>
                  <th className="text-left py-3 px-4 text-text-muted font-medium">
                    Stage
                  </th>
                  <th className="text-left py-3 px-4 text-text-muted font-medium">
                    Attention
                  </th>
                  <th className="text-left py-3 px-4 text-text-muted font-medium">
                    Latest attempt
                  </th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((item) => (
                  <ParticipantTableRow
                    key={item.participantId}
                    item={item}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <div className="text-center py-12 text-text-muted">
          <p>No beta participants match these filters.</p>
          <p className="text-sm mt-1">
            <Link href="/platform/beta" className="text-primary hover:text-primary-hover">
              Clear filters
            </Link>{" "}
            or use the form above to invite your first beta tester.
          </p>
        </div>
      )}
    </div>
  );
}

import { redirect } from "next/navigation";
import { captureDestinations } from "@/app/src/lib/ocr/captureDestinations";
import { SavedScoreBatches } from "./SavedScoreBatches";
import { OcrConsentGate } from "@/app/account/ocr/OcrConsentGate";
import { PageLayout, Card } from "@/app/src/components";
import { Button } from "@/app/src/components/client";
import { requireAuth } from "@/app/src/lib/auth/requireAuth";
import { loadEvaluationContext } from "@/app/src/lib/ocr/evaluation";
import { loadQaAllianceSettings } from "@/app/src/lib/ocr/qaAlliance";
import { localOcrFixtureEnabled } from "@/app/src/lib/ocr/config";
import { LeaderBatchReview } from "./LeaderBatchReview";
import { ScreenshotReview } from "./ScreenshotReview";

export default async function ScreenshotsPage({ params, searchParams }: {
  params: Promise<{ allianceId: string }>; searchParams: Promise<{ memberId?: string; scope?: string }>;
}) {
  const { allianceId } = await params; const { memberId, scope } = await searchParams;
  const user = await requireAuth();
  if (memberId) redirect(`/alliances/${allianceId}/screenshots?scope=batch`);
  const review = await loadEvaluationContext({ allianceId, actorId: user.id, memberId: null, scope: scope === "batch" ? "batch" : undefined }).catch(() => null);
  const qaSettings = review && scope === "batch" ? await loadQaAllianceSettings(allianceId, user.id).catch(() => null) : null;
  const back = scope === "batch" ? `/alliances/${allianceId}` : `/alliances/${allianceId}/my-record`;
  return <main className="sentry-block" data-sentry-block><PageLayout title={scope === "batch" ? "Capture Evaluation Results" : "Daily VS screenshot review"} maxWidth="6xl"
    description={scope === "batch" ? "Review ranking screenshots and save scores to your alliance." : "Review your daily VS screenshot."}
    action={<Button href={back} variant="secondary">{scope === "batch" ? "Back to alliance" : "Back to member"}</Button>}>
    {review && scope === "batch" && <nav aria-label="Add results" className="mb-4 flex flex-wrap gap-3"><Button href={`/alliances/${allianceId}/screenshots?scope=batch`}>Screenshots</Button><Button variant="secondary" href={`/alliances/${allianceId}/setup/import?method=spreadsheet`}>Spreadsheet</Button><Button variant="secondary" href={`/alliances/${allianceId}/setup/import?method=manual`}>Manual entry</Button></nav>}
    {!review ? <Card><h2 className="text-lg font-semibold">Screenshot evaluation is unavailable</h2>
      <p className="mt-3 text-text-secondary">This trial requires an enabled preview, current access and complete member identity. Ask your leadership team to review your access, or return to your member record.</p></Card>
      : <OcrConsentGate key={review.consent.processing?.id ?? "first-use"} initial={review.consent}>{scope === "batch" ? <LeaderBatchReview key={review.contextKey} allianceId={allianceId} initial={review} destination={await captureDestinations(allianceId)} synthetic={localOcrFixtureEnabled()} qaSettings={qaSettings} />
      : <ScreenshotReview key={`${allianceId}:own:${review.contextKey}`} allianceId={allianceId} memberId={null}
        initial={review} synthetic={localOcrFixtureEnabled()} />}</OcrConsentGate>}
    {review && scope === "batch" && <SavedScoreBatches allianceId={allianceId} />}
  </PageLayout></main>;
}

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
  const review = await loadEvaluationContext({ allianceId, actorId: user.id, memberId: memberId || null, scope: scope === "batch" ? "batch" : undefined }).catch(() => null);
  const qaSettings = review && scope === "batch" ? await loadQaAllianceSettings(allianceId, user.id).catch(() => null) : null;
  const back = scope === "batch" ? `/alliances/${allianceId}` : memberId ? `/alliances/${allianceId}/members/${memberId}` : `/alliances/${allianceId}/my-record`;
  return <main className="sentry-block" data-sentry-block><PageLayout title={scope === "batch" ? "Ranking screenshot review" : "Daily VS screenshot review"} maxWidth="6xl"
    description="Check what the screenshot reader can recognize before score submissions become available."
    action={<Button href={back} variant="secondary">{scope === "batch" ? "Back to alliance" : "Back to member"}</Button>}>
    {!review ? <Card><h2 className="text-lg font-semibold">Screenshot evaluation is unavailable</h2>
      <p className="mt-3 text-text-secondary">This trial requires an enabled preview, current access and complete member identity. Ask your leadership team to review your access, or return to your member record.</p></Card>
      : <OcrConsentGate key={review.consent.processing?.id ?? "first-use"} initial={review.consent}>{scope === "batch" ? <LeaderBatchReview key={review.contextKey} allianceId={allianceId} initial={review} synthetic={localOcrFixtureEnabled()} qaSettings={qaSettings} />
      : <ScreenshotReview key={`${allianceId}:${memberId ?? "own"}:${review.contextKey}`} allianceId={allianceId} memberId={memberId || null}
        initial={review} synthetic={localOcrFixtureEnabled()} />}</OcrConsentGate>}
  </PageLayout></main>;
}

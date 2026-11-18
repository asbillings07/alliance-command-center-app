import { PageLayout, Card } from "@/app/src/components";
import { Button } from "@/app/src/components/client";
import { requireAuth } from "@/app/src/lib/auth/requireAuth";
import { loadEvaluationContext } from "@/app/src/lib/ocr/evaluation";
import { localOcrFixtureEnabled } from "@/app/src/lib/ocr/config";
import { ScreenshotReview } from "./ScreenshotReview";

export default async function ScreenshotsPage({ params, searchParams }: {
  params: Promise<{ allianceId: string }>; searchParams: Promise<{ memberId?: string }>;
}) {
  const { allianceId } = await params; const { memberId } = await searchParams;
  const user = await requireAuth();
  const review = await loadEvaluationContext({ allianceId, actorId: user.id, memberId: memberId || null }).catch(() => null);
  const back = memberId ? `/alliances/${allianceId}/members/${memberId}` : `/alliances/${allianceId}/my-record`;
  return <main className="sentry-block" data-sentry-block><PageLayout title="Daily VS screenshot review" maxWidth="6xl"
    description="Check what the screenshot reader can recognize before score submissions become available."
    action={<Button href={back} variant="secondary">Back to member</Button>}>
    {!review ? <Card><h2 className="text-lg font-semibold">Screenshot evaluation is unavailable</h2>
      <p className="mt-3 text-text-secondary">This trial requires an enabled preview, current access and complete member identity. Ask your leadership team to review your access, or return to your member record.</p></Card>
      : <ScreenshotReview key={`${allianceId}:${memberId ?? "own"}:${review.contextKey}`} allianceId={allianceId} memberId={memberId || null}
        initial={review} synthetic={localOcrFixtureEnabled()} />}
  </PageLayout></main>;
}

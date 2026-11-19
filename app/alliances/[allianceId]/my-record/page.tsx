import { PageLayout, Card, Badge } from "@/app/src/components";
import { Button } from "@/app/src/components/client";
import { requireAuth } from "@/app/src/lib/auth/requireAuth";
import { loadOwnMemberRecord } from "@/app/src/lib/memberSelfAccess";
import { ocrEvaluationAvailable } from "@/app/src/lib/ocr/evaluation";

export default async function MyMemberRecordPage({ params }: { params: Promise<{ allianceId: string }> }) {
  const { allianceId } = await params;
  const user = await requireAuth();
  const record = await loadOwnMemberRecord(allianceId, user.id);
  return <main><PageLayout title="My member record" description="Your approved identity for future screenshot submissions." maxWidth="2xl"
    action={<Button href="/alliances/my-records" variant="secondary">My member records</Button>}>
    {!record ? <Card><Card.Body><h2 className="text-lg font-semibold">Member access is unavailable</h2>
      <p className="mt-3 text-text-secondary">Ask an alliance owner or admin to review your account link, identity confirmation and member-access approval.</p>
    </Card.Body></Card> : <div className="space-y-6">
      <Card><Card.Body><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">Your identity</h2><Badge variant="success">Identity confirmed</Badge></div>
        <dl className="mt-5 space-y-4"><div><dt className="text-sm text-text-muted">In-game name</dt><dd className="mt-1 break-words font-medium">{record.playerName}</dd></div>
          <div><dt className="text-sm text-text-muted">Alliance</dt><dd className="mt-1 break-words">{record.allianceName}</dd></div>
          <div><dt className="text-sm text-text-muted">Server</dt><dd className="mt-1 break-words">{record.server}</dd></div></dl>
        <p className="mt-5 text-sm text-text-secondary">If these details change, ask your leadership team to review them. You cannot change your identity or account link here.</p>
      </Card.Body></Card>
      <Card><Card.Body><h2 className="text-lg font-semibold">Screenshot submissions</h2><p className="mt-3 text-text-secondary">Your identity and member access are approved. Screenshot uploads are not available yet.</p>
        <p className="mt-3 text-sm text-text-muted">When uploads become available, the screenshot must clearly identify you and match this verified record. An identity change or revoked approval will require another review.</p>
        <div className="mt-4">{await ocrEvaluationAvailable({ allianceId, actorId: user.id, memberId: null }) ? <Button href={`/alliances/${allianceId}/screenshots`}>Try daily VS screenshot review</Button> : <Button disabled>Screenshot uploads unavailable</Button>}</div>
      </Card.Body></Card>
    </div>}
  </PageLayout></main>;
}

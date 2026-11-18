import { PageLayout, Card } from "@/app/src/components";
import { Button } from "@/app/src/components/client";
import { requireAuth } from "@/app/src/lib/auth/requireAuth";
import { listOwnMemberRecords } from "@/app/src/lib/memberSelfAccess";

export default async function MyMemberRecordsPage() {
  const user = await requireAuth();
  const records = await listOwnMemberRecords(user.id);
  return <main><PageLayout title="My member records" description="Records your alliance has approved for your account." maxWidth="2xl">
    {records.length === 0 ? <Card><Card.Body><h2 className="text-lg font-semibold">No approved member access</h2><p className="mt-3 text-text-secondary">Ask an alliance owner or admin to review your account link, confirm your identity and approve member access.</p><p className="mt-3 text-sm text-text-muted">Existing leadership access is managed separately.</p></Card.Body></Card>
      : <ul className="space-y-4">{records.map((record) => <li key={record.allianceId}><Card><Card.Body>
        <h2 className="break-words text-lg font-semibold">{record.allianceName}</h2><p className="mt-2 break-words text-text-secondary">{record.playerName} · Server {record.server}</p>
        <div className="mt-4"><Button href={`/alliances/${record.allianceId}/my-record`}>Open my member record</Button></div>
      </Card.Body></Card></li>)}</ul>}
  </PageLayout></main>;
}

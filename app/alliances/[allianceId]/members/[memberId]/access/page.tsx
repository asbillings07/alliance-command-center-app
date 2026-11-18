import { notFound } from "next/navigation";
import { PageLayout, Card, Badge } from "@/app/src/components";
import { Button } from "@/app/src/components/client";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { Permissions } from "@/app/src/lib/auth/permissions";
import { loadMemberAccessReview, MemberAccessError } from "@/app/src/lib/memberSelfAccess";
import { IdentityReviewError } from "@/app/src/lib/memberIdentity";
import { MemberAccessForm } from "./MemberAccessForm";

const time = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
export default async function MemberAccessPage({ params }: { params: Promise<{ allianceId: string; memberId: string }> }) {
  const { allianceId, memberId } = await params;
  const { user } = await requireAllianceAccess({ allianceId, requiredPermission: Permissions.MANAGE_MEMBERS });
  const review = await loadMemberAccessReview(allianceId, memberId, user.id).catch((error) => {
    if (error instanceof MemberAccessError || error instanceof IdentityReviewError) notFound();
    throw error;
  });
  const { identity, decisions, enabled } = review;
  const { member } = identity;
  const href = `/alliances/${allianceId}/members/${memberId}`;
  const accountLabel = member.user ? `${member.user.displayName} (${member.user.email})` : "No linked account";
  return <main><PageLayout title="Member access" description="Approve access to this person's own member record." maxWidth="6xl"
    breadcrumb={[{ label: "Members", href: `/alliances/${allianceId}/members` }, { label: member.playerName, href }, { label: "Member access" }]}
    action={<Button href={href} variant="secondary">Back to member</Button>}>
    <div className="grid min-w-0 gap-6 md:grid-cols-2">
      <Card><Card.Body>
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">Access review</h2>
          <Badge variant={enabled ? "success" : "warning"}>{enabled ? "Member access approved" : decisions[0]?.granted ? "Approval needs review" : "Not approved"}</Badge></div>
        <dl className="mt-5 space-y-4 text-sm">
          <div><dt className="text-text-muted">In-game name</dt><dd className="mt-1 break-words">{member.playerName || "Not recorded"}</dd></div>
          <div><dt className="text-text-muted">Alliance / server</dt><dd className="mt-1 break-words">{member.alliance.name} / {member.alliance.server}</dd></div>
          <div><dt className="text-text-muted">Linked account</dt><dd className="mt-1 break-all">{accountLabel}</dd></div>
        </dl>
        <p className="mt-5 text-sm text-text-secondary">Member access shows only this person&apos;s in-game name and alliance/server. Screenshot uploads are not available yet.</p>
        {review.collaboratorRole && <p className="mt-4 rounded-lg border border-border p-3 text-sm text-warning-light">This account also has {review.collaboratorRole.toLowerCase()} collaborator access. These controls do not remove or reduce those separate permissions.</p>}
        {!identity.confirmed && <div className="mt-4 space-y-3 text-sm text-warning-light"><p>Confirm the current member identity before approving access.</p>
          {identity.missing.length > 0 && <ul className="list-disc space-y-2 pl-5">{identity.missing.map((reason) => <li key={reason}>{reason}</li>)}</ul>}
          <Button href={`${href}/identity`} variant="secondary">Review member identity</Button></div>}
        {decisions[0]?.granted && !enabled && <p className="mt-4 text-sm text-warning-light">The earlier approval no longer provides access. After identity review, an owner or admin must approve access again.</p>}
        <div className="mt-5"><MemberAccessForm allianceId={allianceId} memberId={memberId} reviewKey={review.reviewKey}
          canGrant={identity.confirmed && !enabled} canRevoke={!!decisions[0]?.granted} accountLabel={accountLabel} playerName={member.playerName}
          previousAccount={decisions[0]?.accountName} previousName={decisions[0]?.playerName} /></div>
      </Card.Body></Card>
      <section className="min-w-0" aria-labelledby="member-access-history"><h2 id="member-access-history" className="text-lg font-semibold">Access history</h2>
        <p className="mb-4 mt-1 text-sm text-text-muted">Latest 20 decisions · Times in UTC · Earlier decisions are retained</p>
        {decisions.length === 0 ? <Card><p className="text-sm text-text-muted">No access decisions yet. A linked account or confirmed identity alone does not grant member access.</p></Card>
          : <ol className="space-y-3">{decisions.map((entry) => <li key={entry.id} className="rounded-lg border border-border bg-surface p-4 text-sm">
            <p className="break-words font-semibold">{entry.granted ? "Approved" : "Revoked"} by {entry.actorName || "Unnamed account"}</p>
            <p className="mt-1 text-text-muted">{entry.actorRole.toLowerCase()} · {time.format(entry.createdAt)} UTC</p>
            <p className="mt-3 break-words">{entry.accountName || "Unnamed account"} → {entry.playerName}</p>
          </li>)}</ol>}
      </section>
    </div>
  </PageLayout></main>;
}

import { notFound } from "next/navigation";
import { PageLayout, Card, Badge } from "@/app/src/components";
import { Button } from "@/app/src/components/client";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { Permissions } from "@/app/src/lib/auth/permissions";
import { loadIdentityReview, IdentityReviewError } from "@/app/src/lib/memberIdentity";
import { IdentityReviewForm } from "./IdentityReviewForm";
import { IdentityNameForm } from "./IdentityNameForm";

const time = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
export default async function MemberIdentityPage({ params }: { params: Promise<{ allianceId: string; memberId: string }> }) {
  const { allianceId, memberId } = await params;
  const { user } = await requireAllianceAccess({ allianceId, requiredPermission: Permissions.MANAGE_MEMBER_IDENTITY });
  const review = await loadIdentityReview(allianceId, memberId, user.id).catch((error) => {
    if (error instanceof IdentityReviewError) notFound();
    throw error;
  });
  const { member, missing, confirmed, decisions } = review;
  const memberHref = `/alliances/${allianceId}/members/${memberId}`;
  return <main><PageLayout maxWidth="6xl" title="Member identity"
    description="Review the identity that will be used for screenshot submissions."
    breadcrumb={[{ label: "Members", href: `/alliances/${allianceId}/members` }, { label: member.playerName, href: memberHref }, { label: "Member identity" }]}
    action={<Button variant="secondary" href={memberHref}>Back to member</Button>}>
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-surface-secondary p-4 text-sm text-text-secondary">
        Screenshot uploads are not available yet. Identity confirmation prepares this record; it does not enable uploads or grant additional account access.
      </div>
      <div className="grid min-w-0 gap-6 md:grid-cols-2">
        <Card><Card.Body>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Current identity</h2>
            <Badge variant={confirmed ? "success" : "warning"}>{confirmed ? "Identity confirmed" : "Needs review"}</Badge>
          </div>
          <dl className="mt-5 space-y-4 text-sm">
            <div><dt className="text-text-muted">In-game name</dt><dd className="mt-1 break-words font-medium">{member.playerName || "Not recorded"}</dd></div>
            <div><dt className="text-text-muted">Alliance / server</dt><dd className="mt-1 break-words">{member.alliance.name || "Not recorded"} / {member.alliance.server || "Not recorded"}</dd></div>
            <div><dt className="text-text-muted">Linked account</dt><dd className="mt-1 break-words">{member.user ? <>{member.user.displayName}<br /><span className="break-all text-text-secondary">{member.user.email}</span></> : "No linked account"}</dd></div>
          </dl>
          {!member.archivedAt && <IdentityNameForm allianceId={allianceId} memberId={memberId}
            reviewKey={review.reviewKey} playerName={member.playerName} />}
          <p className="mt-4 text-sm text-text-muted">Account links are managed by owners and admins from the member profile. Alliance and server changes are managed in alliance settings.</p>
          {missing.length > 0 ? <ul className="mt-5 list-disc space-y-2 pl-5 text-sm text-warning-light">{missing.map((problem) => <li key={problem}>{problem}</li>)}</ul>
            : !confirmed && <p className="mt-5 text-sm text-text-secondary">{decisions[0]?.confirmed ? "Identity details changed after the last confirmation. Check the current details again." : "An owner, admin or leader must verify these details before confirming identity."}</p>}
          <div className="mt-5"><IdentityReviewForm allianceId={allianceId} memberId={memberId} reviewKey={review.reviewKey}
            playerName={member.playerName} canConfirm={missing.length === 0 && !confirmed} canRevoke={!!decisions[0]?.confirmed} /></div>
        </Card.Body></Card>
        <section className="min-w-0" aria-labelledby="identity-history-heading">
          <h2 id="identity-history-heading" className="text-lg font-semibold">Identity history</h2>
          <p className="mb-4 mt-1 text-sm text-text-muted">Latest 20 decisions · Times in UTC · Earlier decisions are retained</p>
          {decisions.length === 0 ? <Card><p className="text-sm text-text-muted">No identity decisions yet. An existing account link is not a confirmation.</p></Card>
            : <ol className="space-y-3">{decisions.map((entry) => <li key={entry.id} className="rounded-lg border border-border bg-surface p-4 text-sm">
              <p className="font-semibold">{entry.previousPlayerName !== null ? "In-game name changed" : entry.confirmed ? "Confirmed" : "Revoked"} by <span className="break-words">{entry.actorName || "Unnamed account"}</span></p>
              <p className="mt-1 text-text-muted">{entry.actorRole.toLowerCase()} · {time.format(entry.createdAt)} UTC</p>
              {entry.previousPlayerName !== null && <p className="mt-3 break-words">{entry.previousPlayerName} → {entry.playerName}. Identity confirmation required again.</p>}
              <p className="mt-3 break-words">{entry.playerName} · {entry.allianceName} / {entry.server}</p>
            </li>)}</ol>}
        </section>
      </div>
    </div>
  </PageLayout></main>;
}

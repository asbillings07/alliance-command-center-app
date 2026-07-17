import Link from "next/link";
import { Badge } from "@/app/src/components";
import {
  getBetaInvitations,
  getInvitationStats,
  type BetaInvitationItem,
} from "@/app/src/lib/platform";
import { InviteBetaTester } from "./InviteBetaTester";
import { InvitationActions, InvitationCardActions } from "./InvitationActions";

/**
 * Platform Beta
 *
 * Answers: "Manage the beta program."
 *
 * Features:
 * - Create beta invitations
 * - Beta invitation list
 * - Invitation status
 * - Actions (copy, revoke)
 */

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year:
      date.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
  });
}

const statusConfig = {
  pending: { variant: "info" as const, label: "Pending" },
  accepted: { variant: "success" as const, label: "Accepted" },
  expired: { variant: "danger" as const, label: "Expired" },
  revoked: { variant: "warning" as const, label: "Revoked" },
};

function InvitationCard({ invitation }: { invitation: BetaInvitationItem }) {
  const config = statusConfig[invitation.status];

  return (
    <div className="bg-surface-secondary rounded-lg border border-border p-4">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-medium text-text-primary">{invitation.email}</h3>
          <p className="text-xs text-text-muted mt-1">
            Sent {formatDate(invitation.issuedAt)}
            {invitation.status === "pending" &&
              ` • Expires ${formatDate(invitation.expiresAt)}`}
            {invitation.status === "accepted" &&
              invitation.acceptedAt &&
              ` • Accepted ${formatDate(invitation.acceptedAt)}`}
          </p>
          {invitation.notes && (
            <p className="text-xs text-text-muted mt-1 italic">
              {invitation.notes}
            </p>
          )}
        </div>
        <Badge variant={config.variant} size="sm">
          {config.label}
        </Badge>
      </div>

      {invitation.status === "accepted" && (
        <div className="mt-3 pt-3 border-t border-border">
          {invitation.hasAlliance ? (
            <Link
              href={`/platform/support/alliance/${invitation.allianceId}`}
              className="text-sm text-primary hover:text-primary-hover"
            >
              View {invitation.allianceName} →
            </Link>
          ) : (
            <span className="text-sm text-warning">
              ⚠️ No alliance created yet
            </span>
          )}
        </div>
      )}

      {invitation.status === "pending" && (
        <InvitationCardActions
          invitationId={invitation.id}
          code={invitation.code}
          inviteUrl={invitation.inviteUrl}
        />
      )}
    </div>
  );
}

function PendingInvitationTable({
  invitations,
}: {
  invitations: BetaInvitationItem[];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left py-3 px-4 text-text-muted font-medium">
              Email
            </th>
            <th className="text-left py-3 px-4 text-text-muted font-medium">
              Code
            </th>
            <th className="text-left py-3 px-4 text-text-muted font-medium">
              Sent
            </th>
            <th className="text-left py-3 px-4 text-text-muted font-medium">
              Expires
            </th>
            <th className="text-left py-3 px-4 text-text-muted font-medium">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {invitations.map((invitation) => (
            <tr
              key={invitation.id}
              className="border-b border-border hover:bg-surface-secondary transition-colors"
            >
              <td className="py-3 px-4">
                <div className="text-text-primary">{invitation.email}</div>
                {invitation.notes && (
                  <div className="text-xs text-text-muted italic">
                    {invitation.notes}
                  </div>
                )}
              </td>
              <td className="py-3 px-4">
                <code className="text-xs bg-surface-secondary px-1.5 py-0.5 rounded">
                  {invitation.code}
                </code>
              </td>
              <td className="py-3 px-4 text-text-muted">
                {formatDate(invitation.issuedAt)}
              </td>
              <td className="py-3 px-4 text-text-muted">
                {formatDate(invitation.expiresAt)}
              </td>
              <td className="py-3 px-4">
                <InvitationActions
                  invitationId={invitation.id}
                  code={invitation.code}
                  inviteUrl={invitation.inviteUrl}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InvitationTable({
  invitations,
}: {
  invitations: BetaInvitationItem[];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left py-3 px-4 text-text-muted font-medium">
              Email
            </th>
            <th className="text-left py-3 px-4 text-text-muted font-medium">
              Status
            </th>
            <th className="text-left py-3 px-4 text-text-muted font-medium">
              Sent
            </th>
            <th className="text-left py-3 px-4 text-text-muted font-medium">
              Accepted
            </th>
            <th className="text-left py-3 px-4 text-text-muted font-medium">
              Alliance
            </th>
          </tr>
        </thead>
        <tbody>
          {invitations.map((invitation) => {
            const config = statusConfig[invitation.status];
            return (
              <tr
                key={invitation.id}
                className="border-b border-border hover:bg-surface-secondary transition-colors"
              >
                <td className="py-3 px-4 text-text-primary">
                  {invitation.email}
                </td>
                <td className="py-3 px-4">
                  <Badge variant={config.variant} size="sm">
                    {config.label}
                  </Badge>
                </td>
                <td className="py-3 px-4 text-text-muted">
                  {formatDate(invitation.issuedAt)}
                </td>
                <td className="py-3 px-4 text-text-muted">
                  {invitation.acceptedAt
                    ? formatDate(invitation.acceptedAt)
                    : "—"}
                </td>
                <td className="py-3 px-4">
                  {invitation.hasAlliance ? (
                    <Link
                      href={`/platform/support/alliance/${invitation.allianceId}`}
                      className="text-primary hover:text-primary-hover"
                    >
                      {invitation.allianceName}
                    </Link>
                  ) : invitation.status === "accepted" ? (
                    <span className="text-warning">⚠️ None</span>
                  ) : (
                    <span className="text-text-disabled">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default async function PlatformBeta() {
  const [invitations, stats] = await Promise.all([
    getBetaInvitations(),
    getInvitationStats(),
  ]);

  const pendingInvitations = invitations.filter((i) => i.status === "pending");
  const acceptedInvitations = invitations.filter(
    (i) => i.status === "accepted"
  );
  const expiredInvitations = invitations.filter((i) => i.status === "expired");
  const revokedInvitations = invitations.filter((i) => i.status === "revoked");

  const acceptedWithoutAlliance = acceptedInvitations.filter(
    (i) => !i.hasAlliance
  );

  return (
    <div className="space-y-8 max-w-6xl">
      {/* Invite Beta Tester Form */}
      <section>
        <InviteBetaTester />
      </section>

      {/* Stats Summary */}
      <section>
        <h2 className="text-lg font-semibold text-text-secondary mb-4">
          Beta Invitations
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="bg-surface-secondary rounded-lg p-4 border border-border">
            <div className="text-2xl font-bold text-text-primary">
              {stats.betaInvites.total}
            </div>
            <div className="text-sm text-text-muted">Total Sent</div>
          </div>
          <div className="bg-success/10 rounded-lg p-4 border border-success/20">
            <div className="text-2xl font-bold text-success">
              {stats.betaInvites.accepted}
            </div>
            <div className="text-sm text-success/80">Accepted</div>
          </div>
          <div className="bg-primary/10 rounded-lg p-4 border border-primary/20">
            <div className="text-2xl font-bold text-primary">
              {stats.betaInvites.pending}
            </div>
            <div className="text-sm text-primary/80">Pending</div>
          </div>
          <div className="bg-warning/10 rounded-lg p-4 border border-warning/20">
            <div className="text-2xl font-bold text-warning">
              {stats.betaInvites.expired}
            </div>
            <div className="text-sm text-warning/80">Expired</div>
          </div>
          <div className="bg-danger/10 rounded-lg p-4 border border-danger/20">
            <div className="text-2xl font-bold text-danger">
              {stats.betaInvites.revoked}
            </div>
            <div className="text-sm text-danger/80">Revoked</div>
          </div>
        </div>
      </section>

      {/* Warning: Accepted but no alliance */}
      {acceptedWithoutAlliance.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-text-secondary mb-4">
            ⚠️ Accepted Without Alliance
            <span className="ml-2 text-sm font-normal text-warning">
              ({acceptedWithoutAlliance.length})
            </span>
          </h2>
          <div className="bg-warning/10 rounded-lg border border-warning/20 p-4">
            <p className="text-sm text-warning mb-3">
              These users accepted their beta invitation but haven&apos;t
              created an alliance yet.
            </p>
            <div className="space-y-2">
              {acceptedWithoutAlliance.map((invitation) => (
                <div
                  key={invitation.id}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="text-text-primary">{invitation.email}</span>
                  <span className="text-text-muted">
                    Accepted {formatDate(invitation.acceptedAt!)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Pending Invitations */}
      {pendingInvitations.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-text-secondary mb-4">
            Pending
            <span className="ml-2 text-sm font-normal text-primary">
              ({pendingInvitations.length})
            </span>
          </h2>
          {/* Mobile: Cards */}
          <div className="md:hidden space-y-3">
            {pendingInvitations.map((invitation) => (
              <InvitationCard key={invitation.id} invitation={invitation} />
            ))}
          </div>
          {/* Desktop: Table with Actions */}
          <div className="hidden md:block bg-surface rounded-lg border border-border">
            <PendingInvitationTable invitations={pendingInvitations} />
          </div>
        </section>
      )}

      {/* Accepted Invitations */}
      {acceptedInvitations.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-text-secondary mb-4">
            Accepted
            <span className="ml-2 text-sm font-normal text-success">
              ({acceptedInvitations.length})
            </span>
          </h2>
          {/* Mobile: Cards */}
          <div className="md:hidden space-y-3">
            {acceptedInvitations.map((invitation) => (
              <InvitationCard key={invitation.id} invitation={invitation} />
            ))}
          </div>
          {/* Desktop: Table */}
          <div className="hidden md:block bg-surface rounded-lg border border-border">
            <InvitationTable invitations={acceptedInvitations} />
          </div>
        </section>
      )}

      {/* Expired Invitations */}
      {expiredInvitations.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-text-secondary mb-4">
            Expired
            <span className="ml-2 text-sm font-normal text-danger">
              ({expiredInvitations.length})
            </span>
          </h2>
          {/* Mobile: Cards */}
          <div className="md:hidden space-y-3">
            {expiredInvitations.map((invitation) => (
              <InvitationCard key={invitation.id} invitation={invitation} />
            ))}
          </div>
          {/* Desktop: Table */}
          <div className="hidden md:block bg-surface rounded-lg border border-border">
            <InvitationTable invitations={expiredInvitations} />
          </div>
        </section>
      )}

      {/* Revoked Invitations */}
      {revokedInvitations.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-text-secondary mb-4">
            Revoked
            <span className="ml-2 text-sm font-normal text-warning">
              ({revokedInvitations.length})
            </span>
          </h2>
          {/* Mobile: Cards */}
          <div className="md:hidden space-y-3">
            {revokedInvitations.map((invitation) => (
              <InvitationCard key={invitation.id} invitation={invitation} />
            ))}
          </div>
          {/* Desktop: Table */}
          <div className="hidden md:block bg-surface rounded-lg border border-border">
            <InvitationTable invitations={revokedInvitations} />
          </div>
        </section>
      )}

      {/* Empty State */}
      {invitations.length === 0 && (
        <div className="text-center py-12 text-text-muted">
          <p>No beta invitations yet.</p>
          <p className="text-sm mt-1">
            Use the form above to invite your first beta tester.
          </p>
        </div>
      )}
    </div>
  );
}

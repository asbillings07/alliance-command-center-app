# Explicit access to a member's own record

Issue [#396](https://github.com/asbillings07/alliance-command-center-app/issues/396), child of #295, follows the identity-readiness slice in #390. This slice supports **existing, already-linked accounts**. It does not create accounts, send invitations, link accounts, process screenshots or write metrics.

## Authority and data boundary

An Owner, Admin or Leader opens Members → a member → Manage member access. After reviewing the current confirmed identity, they explicitly approve or revoke access in a confirmation dialog. A dedicated `MANAGE_MEMBER_ACCESS` capability permits these roles to approve or revoke access to the linked member’s own record. Leaders keep their focused identity-review capability; this does not grant roster mutation, account linking, collaborator invitations or leadership-role management. Approval sends no email.

`AllianceMember.userId` remains the account association. `MemberSelfAccessDecision` records an immutable grant/revocation, the exact identity decision, the target account and player name, and the acting user's identity/name/role at the time. Scalar identifiers intentionally survive source/account deletion; this is audit evidence, not a second identity system. Existing links and confirmations are not grandfathered into grants.

The signed-in account selects an alliance, not a member ID. The server resolves its single linked member, including archived links in ambiguity checks, and validates current identity and the latest explicit grant in one consistent database snapshot. Only alliance ID/name, server and player name leave the member-facing service. Leadership notes, metrics, roster data, emails and audit identities are excluded.

`AllianceMembership` is unchanged; the role matrix adds only the focused member-access capability for Owner/Admin/Leader. A Viewer remains a collaborator with broader visibility. Granting member access creates no collaborator membership; revoking it cannot reduce a separate collaborator role. The approval page explains this when both exist.

## Invalidation and history

Approval binds to the exact confirmed identity decision. Name, link, archive, alliance-name/server changes and identity revocation invalidate access. Changing those values back or reconfirming identity cannot revive the earlier grant: an Owner/Admin/Leader must approve again. Ambiguous account links deny access. Every member-facing request rechecks access; information already rendered in a browser cannot be recalled.

Grant/revoke writes share the identity advisory lock, reauthorize the actor in a serializable transaction and reject a stale review key. Concurrent decisions cannot both commit from the same reviewed state. An interrupted response instructs the user to reload and inspect history before retrying. Revocation records the original grantee even if the member has since been relinked. The latest 20 decisions are displayed; older rows remain retained. History is read-only.

## Navigation and scope

Existing beta, onboarding, platform, collaborator and invitation landing priorities are preserved. Approved ordinary members then land on `/alliances/{allianceId}/my-record`, or `/alliances/my-records` for multiple approved records. Account → My member records also reaches the selector. These routes require sign-in; leadership routes still require collaborator authorization.

The member page displays identity details and an explicit “Screenshot uploads are not available yet” state. It never claims a metric was verified or uploaded. New-member admission, screenshot processing, score authority/finality and metric history remain separate work under #295/#287/#42.

## Verification and Human QA

Use synthetic accounts in local/preview environments. Check grant/cancel/revoke and stale identity warnings, then sign in as the linked account with no collaborator membership. Confirm its own record is readable while leadership routes and other alliances are inaccessible. Check identity change → reconfirmation → fresh access approval, history persistence and separate collaborator access. Exercise phone (320px), tablet (820px), desktop (1280px), keyboard and accessible dialogs.

The migration is additive and has no grant backfill. Existing application versions ignore the new table. No production migration, merge, deployment or live account changes are authorized by this slice's preview QA request.

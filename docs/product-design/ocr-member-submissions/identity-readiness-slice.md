# Member identity confirmation — #389 / #295

This prerequisite lets an owner/admin review and confirm an existing linked member's current in-game name and alliance/server. The member profile leads to **Review member identity**, which lists missing prerequisites, requests an explicit acknowledgement and final confirmation, and preserves a recent decision history. Revocation requires a separate confirmation. The existing MANAGE_MEMBERS permission applies; no role or permission is added.

It does not create account links, invite users, grant ordinary-member access, accept images, run OCR or write metrics. Identity confirmation is only one prerequisite for the later own-record upload workflow. The UI states that screenshot uploads are unavailable. Existing collaborator invitations must not be repurposed as ordinary-member access.

## Data and concurrency contract

MemberIdentityDecision retains immutable, tenant-scoped confirmation/revocation snapshots, actor ID/name/role, target account ID, member name, alliance/server context and system time. No email, image or OCR text is copied into the audit. There are no live-entity foreign keys that would erase or rewrite history when an account/member is removed. Database triggers reject updates/deletes. The UI reads only the latest 20 decisions; this is not a new report value or effective-score replay.

Database-owned identityVersion counters on Alliance and AllianceMember increment on identity-relevant updates from every writer, including old application versions and roster imports. Member rename, account relink, tenant change or archive/restore increments the member counter; alliance name/server changes increment the alliance counter. Counters cannot be reset through ordinary UPDATE. Changes away and back require new confirmation; unrelated power/metric/setup changes do not. Existing rows start at zero and no confirmation is backfilled.

Each decision uses a transaction-scoped advisory lock for the member and Serializable isolation. Actor role/profile rows are share-locked and permissions are rechecked. The reviewed versions, link uniqueness and latest decision must still match. A serialization failure returns a fresh-review instruction without automatic retry. Current eligibility compares the recorded versions with current identity and requires exactly one linked member for that account in the alliance, including archived records. Context changed concurrently with a decision cannot leave that old context eligible. This decision sequence is scoped to one member, not a global transaction-commit timeline.

UI acknowledgement is required by the action and domain service. Caller-supplied scope or actor fields are never spread into the trusted context. Unknown response outcomes direct the leader to inspect history before retrying; the UI does not promise rollback.

## Acceptance and next gate

Real PostgreSQL checks cover existing unapproved links, confirmation/revocation, authority/tenant isolation, immutable history, stale and concurrent decisions, identity changes away/back, harmless property edits and role changes while admission waits. Browser journeys exercise cancellation, final confirmation, persistence, revocation, stale-review errors, missing links, access denial, keyboard focus and accessibility at phone/tablet/desktop widths.

The next Human QA gate is this implemented identity review on a Vercel preview. Ordinary-member admission/own-record access and OCR extraction/score acceptance remain separate slices under #295. The provider, image retention, completed-day evidence and fixed reset observation decisions remain open as described in README.md. The parent issues remain open.

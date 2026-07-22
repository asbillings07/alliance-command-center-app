# Beta Data Cleanup Runbook

Prepare production data and operations for the closed beta (issue #161). This
removes test/smoke data through a reviewed, manifest-bound, transactional
operation — never manual row deletion or a database reset.

The tooling is [`scripts/cleanup-beta-data.ts`](../../scripts/cleanup-beta-data.ts)
(`npm run beta:cleanup`); its planning core is
[`app/src/lib/operations/betaCleanup.ts`](../../app/src/lib/operations/betaCleanup.ts).

## Safety model

- **Dry run is the default.** Without `--execute` the script only reads, prints
  an inventory + the proposed plan, and writes a manifest for review.
- **The manifest never authenticates its own `ops` field.** `--execute`
  re-resolves the plan **live from the database, inside the execution
  transaction**, and only that freshly-resolved plan is ever mutated. A
  hand-edited `ops` array in the manifest file has no effect on what runs —
  only the checksum, cutoff, and database identity recorded in the manifest are
  trusted, and execution aborts unless the live re-resolution reproduces the
  exact same checksum. The manifest is also self-checked (its own recorded
  fields must reproduce its own checksum) before anything else happens, to
  fail fast on a corrupted or tampered file.
- **One Serializable transaction, start to finish.** Acquiring the
  `pg_advisory_xact_lock`, re-resolving the plan, verifying it against the
  manifest, and executing every operation all happen inside the same
  `Serializable` transaction — so two runs can't interleave, and the
  verification reads can't be stale relative to the writes that follow.
- **Every operation's row count is checked before commit.** Delete, nullify,
  *and* revoke operations each have their affected-row count compared against
  the reviewed plan's expected count **inside the transaction**; any mismatch
  throws and rolls back the entire transaction — nothing partially applies.
- **Frozen cutoff for age-based staleness.** The dry run records the resolved
  cutoff date/time in the manifest; `--execute` reuses that exact value rather
  than recomputing "N days ago" against the current time, so the boundary
  never drifts between review and execution.
- **An explicit confirmation phrase is always required.** `--execute` requires
  `--confirm "DELETE BETA DATA"` (the exact phrase), independent of whether the
  target is production — this guards against a copy/pasted or scripted
  invocation running destructively by accident.
- **Same identity resolver as the app.** The target database is identified with
  `app/src/lib/productionDb` (ADR-016) — pooled and direct Neon hosts collapse
  to one endpoint id — so the tool and the app never disagree about which
  database is production. `--execute` against a production identity additionally
  requires `--confirm-production`, and refuses entirely if `PRODUCTION_DB_HOSTS`
  is unset.
- **Tenant and user deletion are separate, and keep lists are enforced, not just
  recorded.** `--alliance-id` deletes a tenant's owned records; `--user-email`
  deletes an account. Naming the same id/email in both a target flag and its
  `--keep-*` counterpart aborts immediately (before any query runs). A
  keep-listed user may still lose data from a deleted tenant, but their account
  is never deleted — the plan aborts if it would. An unresolved
  `--keep-user-email` (a typo) **fails closed**: the run aborts rather than
  silently treating it as "nothing to keep."
- **Conservative stale cleanup.** `Feedback` and `AccessRequest` are removed
  only by **explicit id**, never by age — these categories need a human
  decision about what's genuinely test data, not an age heuristic, so this is
  an intentional scope boundary rather than a missing feature. Invitations are
  **revoked** (audit-preserving), not deleted. Expired/consumed security tokens
  are deleted by age, since they carry no information worth preserving once
  invalid.
- **Independent post-hoc audit.** `--verify` re-checks, read-only, that every
  operation recorded in a manifest was actually fully applied (rows gone,
  fields nulled/timestamped as expected) — useful right after an execute, or
  any time later, without re-running anything destructive.

## Preconditions (gates)

1. **Preview isolation is live** — PR #162 / ADR-016 deployed, with a separate
   Preview Neon database and restricted Preview email verified in both
   environments. See [ADR-016](../adr/016-preview-production-isolation.md).
2. **A verified restore exists** — follow [backups.md](./backups.md) "Pre-Beta
   Restore Test": create a point-in-time branch, confirm record counts, and
   confirm a local app instance connects to the restored branch and can log in.
   Do not delete anything until this passes.

## Operational order

1. Configure separate Preview resources and `PRODUCTION_DB_HOSTS` (ADR-016).
2. Verify the restore branch (backups.md) — **before any deletion**.
3. Merge/deploy Preview isolation (#162); confirm Production and Preview behavior.
4. Merge the cleanup tooling (this PR).
5. Generate and review the cleanup manifest (dry run).
6. Execute the exact manifest.
7. Run database verification **plus** the human Platform Console check.
8. Complete the clean-room beta journey.
9. Retain or remove the smoke tenant per the decision below.
10. Invite the first 1–3 leaders.
11. Complete #160 (reset rate limiting / timing) before widening the cohort.

## What stays

Identify explicitly, and pass to the keep list:

- The **platform-admin** account (`PLATFORM_ADMIN_EMAILS`) — `--keep-user-email`.
- The **dedicated smoke** account (`SMOKE_PASSWORD_EMAIL` / `SMOKE_GOOGLE_EMAIL`)
  — `--keep-user-email`.
- The retained **smoke tenant**, if kept (see lifecycle decision) —
  `--keep-alliance-id`.

## Step 5 — Generate the manifest (dry run)

Enumerate the test tenants and accounts first (the printed inventory helps).
Then:

```bash
npm run beta:cleanup -- \
  --alliance-id <test-alliance-id> \
  --user-email test1@example.com --user-email test2@example.com \
  --keep-user-email <platform-admin-email> \
  --keep-user-email <smoke-account-email> \
  --keep-alliance-id <smoke-alliance-id> \
  --include-expired-reset-tokens \
  --include-consumed-email-changes \
  --include-stale-beta-invitations \
  --feedback-ids <id,id> \
  --access-request-ids <id,id> \
  --manifest ./beta-cleanup-manifest.json
```

Review, per category, the printed plan and the written manifest:

- Confirm every `DELETE Alliance` / `DELETE User` line is genuinely test data.
- Confirm `REVOKE` (invitations) and `NULL` (disassociations) lines look right.
- Confirm `Feedback` / `AccessRequest` deletes are only the ids you chose.
- Confirm no keep-listed account appears under a `DELETE User` step (the script
  aborts if so, but verify intent).

## Step 6 — Execute

Re-run with `--execute`, the exact confirmation phrase, `--confirm-production`
(when targeting production), and the **same** selection/keep/stale flags used
for the dry run:

```bash
npm run beta:cleanup -- --execute --confirm-production \
  --confirm "DELETE BETA DATA" \
  <same selection + keep + stale flags as the dry run> \
  --manifest ./beta-cleanup-manifest.json
```

If the database changed since the dry run — including a stale-invitation
selection where new rows now qualify — the run aborts before mutating
anything, inside the transaction, and rolls back cleanly. Regenerate the
manifest (Step 5) and re-review.

## Step 7 — Verify

The script prints the after-inventory on a successful execute. Then run the
independent, read-only audit against the same manifest:

```bash
npm run beta:cleanup -- --verify --manifest ./beta-cleanup-manifest.json
```

This re-checks every recorded operation directly against the database (rows
gone for deletes, fields nulled/timestamped for nullify/revoke) and prints a
PASS/FAIL summary. Additionally:

- Confirm expected post-cleanup record counts (users, alliances, invitations,
  feedback, tokens, metrics, periods, entries, notes) match your intent.
- **Human check:** open the Platform Console and confirm no test alliances
  remain (an operator lens, not a count).

## Step 8 — Clean-room walkthrough

Run a fresh invitation through the complete journey on production:
registration → alliance creation → member import → metrics configuration →
evaluation period creation → first dataset import → dashboard verification →
leadership invitation + permission sanity check → feedback submission → sign
out / sign in → password reset.

## Step 9 — Smoke-tenant lifecycle decision

The walkthrough recreates test data, so decide explicitly (do not leave
ambiguous):

- **Retain** the walkthrough alliance as the permanent smoke tenant — add its
  id to `--keep-alliance-id` in all future cleanups and record the id here; **or**
- **Remove** it by running the cleanup again (Steps 5–6) with its
  `--alliance-id` after sign-off.

Record the decision (and the retained id, if any) in this file when made so
"no test alliances in Production" stays true.

## Related documents

- [ADR-016: Preview / Production Isolation](../adr/016-preview-production-isolation.md)
- [backups.md](./backups.md) — restore test (Precondition 2)
- [release-checklist.md](./release-checklist.md)

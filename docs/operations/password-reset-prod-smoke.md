# Runbook: Password Reset Production Smoke (#159)

The authoritative, immediately-after-deploy smoke test for the password-reset
release. Rehearse against preview, merge only when fully green, migrate/deploy
the exact release, then run a **narrow** automated suite in production and
finish with a short manual acceptance pass.

This is the only sanctioned way to run a mutating test against production. Do
**not** point the full E2E suite at production, and do **not** load-test the
public endpoints (see [#160](https://github.com/asbillings07/alliance-command-center-app/issues/160)).

- Canonical production URL: `https://alliancehqapp.com`
- Canonical host (for the safety lock): `alliancehqapp.com`

---

## 1. Where the code lives (nothing to write)

Everything is already merged in #159. You do not add or edit any code to run
this; you only add secrets (section 2) and enter dispatch inputs (section 5).

| Purpose | File |
| --- | --- |
| Manual, approval-gated workflow | `.github/workflows/prod-smoke.yml` |
| Playwright `prod-smoke` project (remote target, no local server, artifacts on failure) | `playwright.config.mjs` |
| Safety rails + shared helpers | `e2e/prod-smoke/smoke.helpers.ts` |
| The canaries | `e2e/prod-smoke/password-reset.prod-smoke.spec.ts` |

The suite fails closed unless all three hold: the `prod-smoke` project is
selected, `PROD_SMOKE=1`, and `ALLOW_PROD_MUTATIONS=true`. It also refuses to
run against `localhost` and — when `PROD_SMOKE_EXPECTED_HOST` is set — against
any host that isn't an exact match.

---

## 2. Where to add the variables (one-time setup)

All secrets live in a **GitHub Environment**, not in repo-wide Actions secrets,
so the run is gated by an approval.

### 2a. Create the `production` environment + approval gate

GitHub → the repo → **Settings → Environments → New environment** → name it
`production` (the workflow's `environment: production` binds to this exact
name). Then, on that environment:

- **Required reviewers** → add yourself (or the release owner). Every
  `Prod Smoke` run will now pause for approval before it touches production.
- (Optional) **Deployment branches** → restrict to `main`.

### 2b. Add the environment secrets

Same page → **Environment secrets → Add secret**. Add each of these (names must
match exactly — the workflow maps them into the run):

| Secret | What it is |
| --- | --- |
| `PROD_SMOKE_EXPECTED_HOST` | `alliancehqapp.com` — the host lock |
| `SMOKE_PASSWORD_EMAIL` | The password-only smoke account's email |
| `SMOKE_PASSWORD_CURRENT` | That account's current password |
| `SMOKE_PASSWORD_NEW` | The password the reset run will set (any value ≥ 8 chars; e.g. a long random string) |
| `SMOKE_GOOGLE_EMAIL` | The Google-only smoke account's email |
| `SMOKE_DUAL_EMAIL` | The dual-auth (password + Google) smoke account's email |
| `SMOKE_DUAL_PASSWORD` | The dual-auth account's password |

Notes:
- `base_url`, the optional `reset_link`, and the `confirm` phrase are **not**
  secrets — you type them into the "Run workflow" form each time (section 5).
- `SMOKE_PASSWORD_NEW` is optional; if omitted the suite derives a per-run
  value. Setting it explicitly makes the post-run rotation in section 7 simpler.

### 2c. Prepare the smoke accounts (one-time)

- Create a dedicated smoke inbox (e.g. a Gmail alias) you can read.
- Provision three accounts via the normal beta/registration flow:
  - **password-only** → `SMOKE_PASSWORD_EMAIL` / `SMOKE_PASSWORD_CURRENT`
  - **Google-only** → `SMOKE_GOOGLE_EMAIL`
  - **dual-auth** → `SMOKE_DUAL_EMAIL` / `SMOKE_DUAL_PASSWORD`, with Google linked
- Generate a fresh beta invitation for the onboarding checkpoint.

---

## 3. Rehearse before merge (already done for the current SHA)

Run the deterministic canaries against the PR's preview deploy — no secrets,
mutation flag on, host lock set to the preview host:

```bash
PREVIEW="https://<this-prs-preview>.vercel.app"
PROD_SMOKE=1 \
ALLOW_PROD_MUTATIONS=true \
PROD_SMOKE_BASE_URL="$PREVIEW" \
PROD_SMOKE_EXPECTED_HOST="$(echo "$PREVIEW" | sed -E 's#https?://##')" \
npx playwright test --project=prod-smoke
```

Expect: 4 deterministic canaries pass; the 3 credential/link-gated canaries skip
(they need the production secrets + a real emailed link).

---

## 4. Merge + migrate + deploy (the exact release)

1. Record the currently-active production deployment in Vercel (for rollback —
   see [rollback.md](./rollback.md)). Pause unrelated merges.
2. Merge #159. Treat it as the only release under test.
3. Preferred (gated promotion): build the merge SHA → `prisma migrate deploy`
   from that SHA → verify both rows land in `_prisma_migrations`
   (`20260722000000_add_password_reset_token`,
   `20260722010000_password_reset_one_active_per_user`) → promote that build.
4. If Vercel auto-deploys and can't be gated, don't race it: the migrations are
   **additive** (new table + partial unique index + FK), so pre-apply the
   reviewed migration immediately before merging, then merge and let it deploy.
   A rolled-back app safely ignores the new table/index.

---

## 5. Run the automated production canaries

GitHub → **Actions → "Prod Smoke (password reset)" → Run workflow**:

- `base_url` = `https://alliancehqapp.com`
- `reset_link` = leave blank on the first run
- `confirm` = `PRODUCTION` (exact; the job aborts otherwise)

Approve the run when it pauses on the `production` environment gate.

First run (no `reset_link`) covers: production reachable, `/forgot-password`
generic response, invalid-token state, post-reset banner, anti-enumeration
parity (password vs Google-only), and password-account sign-in/sign-out. The
full-reset canary skips.

### The one manual hand-off, then finish automated

1. The first run triggers a reset email to `SMOKE_PASSWORD_EMAIL`. Open the
   smoke inbox and copy the reset link (this is also your **manual email
   checkpoint** — section 6).
2. Re-run the workflow with the same inputs **plus** `reset_link` = the copied
   URL. The full-reset canary now runs automated: it establishes a session on
   the old password, consumes the link to set the new password, and asserts the
   old session is revoked, the old password fails, the new password works, and
   the link is single-use.

---

## 6. Manual checkpoints (the ~15% not automated)

- [ ] The reset email actually arrives in the smoke Gmail via Resend.
- [ ] From address, subject, formatting, and spam placement look correct.
- [ ] The reset link uses the canonical origin `https://alliancehqapp.com` —
      not a Vercel preview, `localhost`, or another deployment.
- [ ] Real Google OAuth works in a browser (Google-only and dual-auth accounts;
      dual-auth still logs in with Google after its password reset).
- [ ] Onboarding tour looks right: overlay placement, scrolling, focus, copy,
      completion, and refresh behavior.
- [ ] One narrow/mobile viewport is usable.

---

## 7. Observe, clean up, sign off

- [ ] Check Vercel, application, database, Sentry, and Resend logs for anomalies.
- [ ] Rotate the smoke account password: the reset run left it as
      `SMOKE_PASSWORD_NEW`. Update the `SMOKE_PASSWORD_CURRENT` secret to that
      value (and pick a new `SMOKE_PASSWORD_NEW`) so the next run's "old
      password" is correct.
- [ ] Remove only resources tagged with this run's `SMOKE-<id>` (visible in the
      run logs / created data). Leave the additive migration in place even if the
      app is rolled back.
- [ ] Download the `prod-smoke-report-<run_id>` artifact if any canary failed.
- [ ] End the release lock after ~15–30 minutes of clean observation; resume
      normal merges.

---

## Related

- [Release checklist](./release-checklist.md)
- [Rollback](./rollback.md) · [Backups](./backups.md)
- [ADR-014: transactional email](../adr/014-transactional-email.md)
- Hardening follow-up: rate limiting + timing normalization → #160

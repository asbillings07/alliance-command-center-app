# Managed OCR activation record

Status: **not enabled**. No real Google recognition, cloud storage or credentials
have been qualified. The ordinary PR preview must keep OCR disabled. Production
remains unchanged. Local synthetic transport is workflow evidence only.

## Remaining operator setup

1. The owner links an existing billing account to `orion-os-503204` (project
   number `381354446256`). The console currently reports no billing account.
   Do not enroll in a new paid plan or accept billing terms on the owner's behalf.
2. Use the dedicated Vercel custom environment named `acc-ocr-eval` in ACC
   (`prj_eEU60PIovJyutoJeSXgEPURndcRi`, team
   `team_ovHr1s3JHHZaL2VglNms1ILB`). No production domain or automatic branch
   deployment. Its ID is `env_lRGeyZr1mxbMOrB6niBHc6LX3mWu`. Use a dedicated,
   persistent non-production database and credential, plus a fresh `AUTH_SECRET`
   scoped only to this custom environment. Do not share the ordinary Preview
   database or signing secret. Never copy Production secrets or customer data.
   Non-secret configuration such as verified production database identities can
   be reused. Seed only deliberate QA accounts and synthetic alliance records.
3. Set telemetry off in that environment: empty `SENTRY_DSN`, empty
   `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_REPLAY=false`. Enable only named
   owner-approved QA alliances. Keep `OCR_EVAL_ENABLED=false` until all checks
   below pass. Synthetic transport remains forbidden on Vercel.
4. Before any migration, run the read-only `checkDbIdentity` guard against the
   exact custom-environment values with `VERCEL_ENV=preview`. Verify both database
   connection identities match the new trial database and differ from verified
   Production **and** ordinary Preview identities. `prisma.config.ts` currently
   migrates through `DATABASE_URL`; do not assume it uses `DIRECT_URL`. The app's
   normal startup check runs too late to protect a migration. The deployment
   build must run this preflight before `prisma migrate deploy`, not merely
   before starting Next.js. Record the non-secret identity evidence.
   Set `OCR_EVAL_DB_IDENTITY` to the verified trial endpoint and
   `OCR_EVAL_SHARED_DB_HOSTS` to the verified ordinary-preview endpoint identities.
   Use this build command override only for the isolated evaluation deployment:

   ```sh
   npx tsx scripts/check-ocr-deployment.ts && npx prisma generate && npx prisma migrate deploy && npx next build
   ```

   The check opens no database connection and fails closed for missing pins,
   wrong environment/branch, production/shared endpoints or mismatched connections.
   It also rejects connection-string options that could override the checked
   endpoint; only unique `sslmode=require|verify-ca|verify-full` and
   `channel_binding=require|prefer` query options are accepted.
   It validates the configured identities, not database grants or billing.
   Existing project and production build settings remain unchanged.
5. After independent code review, deploy the exact reviewed commit to this custom
   environment. Record its immutable deployment URL, SHA, environment ID and
   database identity. It is a non-production deployment with separate test auth.
   Preserve this database across deployments: never reset, reseed, replace or
   restore it in a way that reduces already consumed trial allowances. Ordinary
   preview code and credentials must not be able to access it. Row triggers
   alone do not protect a spending ledger from database-owner DDL or TRUNCATE.
   Google sign-in is not configured; use password-capable QA accounts.

## Concrete Google access to review before provisioning

All resources below are new and dedicated to this trial. Do not alter existing
Orion workloads, identities, buckets or permissions. If a named resource already
exists, inspect it; do not overwrite it or silently reuse a broader role.

| Resource | Required scope |
| --- | --- |
| APIs | Vision, Cloud Storage, IAM Credentials and Security Token Service only as needed |
| Service account | `acc-ocr-eval@orion-os-503204.iam.gserviceaccount.com`; no persistent key |
| Bucket | `acc-ocr-eval-orion-os-503204`, US, Standard, uniform access, public-access prevention enforced |
| Retention | sole unconditional `Delete` at age 30 days; soft delete disabled, versioning off, no retention policy or event hold |
| Bucket role | custom role containing only `storage.buckets.get`, `storage.objects.create`, `storage.objects.get`, bound only on the new bucket |
| Project role | `roles/serviceusage.serviceUsageConsumer` for that service account; no Editor/Owner or access to unrelated data |
| Federation | pool `acc-ocr-eval`, provider `vercel-preview`; issuer `https://oidc.vercel.com/aptelum-labs`, audience `https://vercel.com/aptelum-labs` |
| Token condition | exact team ID, project ID, `environment == 'acc-ocr-eval'` and the actual `custom_environment_id`; map `google.subject=assertion.sub` |
| Impersonation | `roles/iam.workloadIdentityUser` on this service account for the exact custom-environment subject only |

The selected environment resolves to this proposed attribute condition:

```text
assertion.owner_id == 'team_ovHr1s3JHHZaL2VglNms1ILB' &&
assertion.project_id == 'prj_eEU60PIovJyutoJeSXgEPURndcRi' &&
assertion.environment == 'acc-ocr-eval' &&
assertion.custom_environment_id == 'env_lRGeyZr1mxbMOrB6niBHc6LX3mWu'
```

Exact allowed subject:
`owner:aptelum-labs:project:alliance-command-center:environment:acc-ocr-eval`.
These are proposed grants, not evidence that federation has been provisioned.

Vercel's documented signed claims do **not** include the Git branch or deployment
ID. Trusting every ordinary preview would allow unrelated preview code to request
Google access. The dedicated custom environment is mandatory; the application's
branch/enable gates supplement rather than replace this trust boundary. Restrict
deployment access to trusted operators. An unreviewed commit must never be sent
to that environment. Each subsequent candidate requires review and QA again.

The activation operation must first show the exact selected environment ID,
IAM condition and narrow grants for approval. No account key, access token or
private image belongs in GitHub, shell output or the review record.

## Verification before the first paid call

- Read the live bucket policy back and pass the application's preflight. Confirm
  that soft-delete disablement is represented correctly by the actual API; do
  not loosen the check based on an assumption.
- Verify workload identity can create/read only this bucket, ordinary Preview
  and Production tokens are denied, and broad project roles are absent.
- Read the durable `acc-managed-ocr-v1` budget ledger. Preserve any already
  consumed attempts. Never truncate or reset a real evaluation allowance.
- Verify anonymous, wrong-tenant, revoked and expired content reads fail; no
  public or signed image links. Confirm telemetry exclusions at runtime.
- Set the environment-specific flag on, then make one consented synthetic scan
  through the authenticated UI. Record attempt ID, provider outcome and budget
  increment without recording image content. $0.01 is reserved even if uncertain.
- Verify private screenshot/result readback and no metric writes. A fake-provider
  browser pass is not a substitute for this managed-provider check.
- Record owner-provided representative screenshots and recognition accuracy
  privately. Missing/incorrect name, ambiguous row and non-final score must be
  plainly visible in Human QA. Do not publish game captures as test fixtures.

The $5 lifetime allowance is for this application's OCR calls. It does not cover
taxes, unrelated project use or hosting. Storage is separately bounded to 500 MiB
of image bytes plus at most 500 × 64 KiB result objects; content reads stop at
5,000. Google budget alerts may supplement these controls. Application shutdown
does not cancel a request already dispatched or reset the ledger. To stop the
trial, disable its flag and federation provider; keep scheduled deletion active.

## Evidence log

### 2026-11-18 setup checkpoint

- Source at `0d8627540ad1c8e0473b73e84a99f55ef40e9a37` passed independent review
  and [CI run 44252998955](https://github.com/asbillings07/alliance-command-center-app/actions/runs/44252998955).
  Local/CI evidence includes 2,781 application tests, 15 OCR Postgres integration
  tests, five OCR browser journeys and 390 complete application browser tests.
  These do not establish real Google recognition success.
- Created and independently read back `acc-ocr-eval`, environment ID above, type
  `preview`, no attached domain or branch tracking, no automatic schedules.
  The project reports deployment protection disabled; private app pages require
  app authentication. Do not describe it as protected by Vercel Authentication.
- Added only custom-environment configuration: OCR disabled, empty alliance
  allowlist, selected Google project/bucket/account names, trusted auth host,
  empty Sentry DSNs, replay false, empty email allowlist and empty Resend key.
  Read back OCR disabled and the telemetry exclusions. No database credential,
  signing secret or production configuration was changed or copied.
- Automatic approval review rejected sharing the ordinary Preview database
  credential. No edit was applied. Independent setup review also found that
  sharing its database/signing secret would undermine isolation of the trial's
  authorization and lifetime spending ledger. The required separate database
  and signing secret above replace that earlier plan.
- Owner reported billing linked, but a fresh Google Console read of Orion OS
  (`orion-os-503204`, number `381354446256`) still reported no linked billing
  account. Owner clarification is pending. Do not infer paid readiness.
- Existing Neon sign-in requires owner authorization. The new Neon integration
  installation screen was inspected but not accepted; no paid plan, database or
  account was created. No database access was granted.
- Google resources, permissions, runtime identity and storage safeguards remain
  unprovisioned/unverified. No managed OCR call was made. The $5 recognition
  cap remains unchanged. Human QA is not yet ready; no merge or production
  deployment is authorized by this checkpoint.

### 2026-11-18 follow-up

- The owner authorized Neon sign-in using GitHub `asbillings07`. The login flow
  reached Neon's existing passkey challenge; owner completion is pending. This
  is no longer an authorization request for the ordinary sign-in. No new Neon
  account, integration or database has been created.
- A fresh check in the owner's Chrome session again found Orion OS unlinked.
  Its enable-billing dialog reports the signed-in account is not administrator
  of any billing account. No billing account was created or linked. The owner
  must finish the project link with the account that administers billing.
- Added a read-only, pre-migration deployment check with synthetic tests for
  production/shared/wrong database rejection, pooled/direct agreement, missing
  pins, delimiter-only exclusions and driver query overrides. It connects to
  no database and affects no existing deployment until the documented isolated
  build override is explicitly used. Real configuration, grants, storage and
  recognition still require qualification; passing these tests is not that proof.

Primary references checked 2026-11-18:

- [Vercel OIDC claims](https://vercel.com/docs/oidc/reference)
- [Vercel Google Cloud federation](https://vercel.com/docs/oidc/gcp)
- [Vision pricing](https://cloud.google.com/vision/pricing)
- [Cloud Storage lifecycle](https://docs.cloud.google.com/storage/docs/lifecycle)

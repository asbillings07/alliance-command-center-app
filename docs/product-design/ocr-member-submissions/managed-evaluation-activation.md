# Managed OCR activation record

Status: **not enabled**. No real Google recognition, cloud storage or credentials
have been qualified. The ordinary PR preview must keep OCR disabled. Production
remains unchanged. Local synthetic transport is workflow evidence only.

## Remaining operator setup

1. The owner links an existing billing account to `orion-os-503204` (project
   number `381354446256`). The console currently reports no billing account.
   Do not enroll in a new paid plan or accept billing terms on the owner's behalf.
2. Create a dedicated Vercel custom environment named `acc-ocr-eval` in ACC
   (`prj_eEU60PIovJyutoJeSXgEPURndcRi`, team
   `team_ovHr1s3JHHZaL2VglNms1ILB`). No production domain or automatic branch
   deployment. Copy only required **Preview** configuration; prove database
   isolation under ADR-016 before migrations. Never copy Production secrets.
3. Set telemetry off in that environment: empty `SENTRY_DSN`, empty
   `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_REPLAY=false`. Enable only named
   owner-approved QA alliances. Keep `OCR_EVAL_ENABLED=false` until all checks
   below pass. Synthetic transport remains forbidden on Vercel.
4. After independent code review, deploy the exact reviewed commit to this custom
   environment. Record its immutable deployment URL, SHA, environment ID and
   database identity. It is a non-production deployment and uses preview auth.

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

Record actual setup, deployment and evaluation observations here before asking
for Human QA. At preparation time, billing and provider activation are pending.
No production release is authorized by this record.

Primary references checked 2026-11-18:

- [Vercel OIDC claims](https://vercel.com/docs/oidc/reference)
- [Vercel Google Cloud federation](https://vercel.com/docs/oidc/gcp)
- [Vision pricing](https://cloud.google.com/vision/pricing)
- [Cloud Storage lifecycle](https://docs.cloud.google.com/storage/docs/lifecycle)

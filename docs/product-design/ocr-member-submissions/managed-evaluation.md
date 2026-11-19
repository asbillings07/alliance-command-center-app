# Managed daily VS recognition evaluation (#402)

Owner approval: 2026-11-18. Managed OCR, daily VS first, screenshot retention of
30 days, a spending cap before enablement, and no production change. Selected
Google Cloud project: Aptelum's `project-106f8c4e-a31b-4e3c-bc5` (number
`735932937321`), superseding the earlier Orion OS selection. Provider setup and
real-image accuracy must be verified separately from synthetic tests.

## Bounded vertical slice

An authorized leader can evaluate a screenshot against a selected active roster
member. An ordinary member can evaluate only against their currently confirmed,
explicitly approved own record. Both inspect a retained image and recognition
results. No metric, period, identity, permission, finality or accepted score is
written. This is a recognition trial, not a score-submission release. PR #401's
authority contract remains a separate inactive dependency of eventual acceptance.

Google Cloud Vision `TEXT_DETECTION` processes one normalized PNG synchronously,
using its US endpoint, behind a replaceable transport. No generative model is
asked to invent missing text. Bounding boxes associate candidate names and values;
ambiguous rows remain unresolved. NFC/whitespace normalization is allowed, but
case folding, accent removal and fuzzy name matching cannot establish identity.
Running countdowns mean in-progress; absent countdowns mean unknown. No upload
timestamp establishes game date, and no result is called final in this trial.

## Authority and concurrency

Server derives member identity from the authenticated account, never a member ID
provided by an ordinary member. Leaders require `IMPORT_METRICS`; a target player
need not have a linked account. Fresh access, identity and archive context is
checked before reservation and dispatch, after recognition and on every read.
Image/result responses are authenticated, private and no-store.

Budget reservation, idempotent attempt creation and dispatch claim are one
transaction. Network calls happen after commit. Same actor/request ID binds the
tenant, target, normalized source digest and processing version. An interrupted,
timed-out or failed dispatch remains consumed; no automatic OCR retries or refunds.
Replaying the same request never calls the provider again. A fresh upload has a
fresh request ID and consumes another reservation. Scores remain unchanged.

## Cost and resource limits

One durable evaluation ledger reserves $0.01 per dispatch, up to **$5 total** and
500 attempts. This conservative reservation exceeds the current $0.0015/image
TEXT_DETECTION rate and assumes no free tier. No monthly rollover or environment
variable can reset the ledger. This caps this application's OCR requests, not
unrelated project activity, taxes or existing hosting charges. Source:
https://cloud.google.com/vision/pricing (checked 2026-11-18).

Limits: one PNG/JPEG, 2 MiB input, 12 megapixels, 1 MiB normalized PNG, 64 KiB
recognition content, 20 uploads/account/day, 500 MiB lifetime image bytes and
5,000 storage read operations for this evaluation. Timeouts and bounded responses
apply. No paid call until the code, ledger, credentials and storage policy pass
preflight. Google billing alerts are supplementary, not the application stop.

## Retention and privacy

Store only a normalized PNG (orientation corrected, metadata removed) and bounded
recognition JSON in a dedicated private GCS bucket. Do not call this image an
untouched original. Raw OCR text and candidates expire with the screenshot;
they are not permanent audit metadata. Durable audit retains the uploader and
role at action, tenant/target snapshots, digest, time, processing version and
outcome. Scoped upload history also stores the original filename (basename only) for new uploads. Earlier entries have no filename. Filenames do not enter the OCR provider payload, analytics, logs or replay. No screenshot or OCR text goes into logs or replay.

Access ends 30 days after upload. Bucket lifecycle deletion runs asynchronously
after age 30; exact physical erasure at that instant is not promised. Require
public-access prevention, uniform bucket access, no versioning, no soft delete,
no retention hold, and a sole unconditional age-30 delete rule. This also covers
abandoned uploads/results. Do not put images or raw OCR in database backups.
Source: https://docs.cloud.google.com/storage/docs/lifecycle.

Use Vercel-to-GCP workload identity with a dedicated service account and narrow
custom-environment trust; no persistent service-account private key.
Ordinary previews are denied; see the [activation checklist](managed-evaluation-activation.md). Provisioning must
not change Orion workloads, production ACC settings or existing bucket policy.
The app refuses production enablement and any hosted test transport. Enable only
the reviewed preview branch and named QA alliances. Keep the provider off until
the account/project and bounded access are verified.

## Evidence before Human QA

- Unit tests: image decoding/limits, parser ambiguity and exact name handling,
  provider errors/timeouts, bucket privacy/retention validation and environment gates.
- Real PostgreSQL: concurrent cap/idempotency, cross-tenant and stale access,
  immutable audit, daily limits, expired reads, and no metric writes.
- Browser: actual upload/review/error/reload flows at 320/820/1280 pixels with
  clearly synthetic local transport; no claim of live recognition accuracy.
- Managed preflight: bucket settings, credentials, one bounded synthetic scan,
  durable budget readback and private read/expiry. Representative game captures
  are a separate quality corpus; do not publish private captures as fixtures.
- Green CI, independent review and owner QA of the exact preview before merge;
  production deployment remains separately gated.

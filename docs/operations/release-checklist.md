# Release Checklist

A short, repeatable checklist for shipping Alliance Command Center, especially
during the Founder Beta when it is easy to forget a step in the excitement of
shipping.

Most quality gates are automated (see [ADR-011](../adr/011-continuous-delivery.md)
and [.github/workflows/ci.yml](../../.github/workflows/ci.yml)); this checklist
covers the human judgement around a release.

## Before merge

- [ ] All CI checks passing (Build, Type Check, ESLint, Unit, Integration, E2E, Accessibility, Visual Regression)
- [ ] PR reviewed and scoped to a single vertical slice
- [ ] New env vars documented in `.env.example` and set in Vercel (all environments that need them)
- [ ] Any new database migration is forward-only and safe to apply to production data

## On merge to `main` (automated)

- [ ] Vercel build succeeds (`prisma generate` -> `prisma migrate deploy` -> `next build`)
- [ ] Post-deploy smoke test passed (`/api/health` healthy, `/login` and `/` load) - see [.github/workflows/smoke-test.yml](../../.github/workflows/smoke-test.yml)

## Manual verification in production

- [ ] Platform admin login verified (password)
- [ ] Google OAuth sign-in verified (once enabled)
- [ ] Invitation flow tested end to end (create -> email received -> redeem)
- [ ] Transactional email delivery confirmed (real inbox, not just logs)
- [ ] `/api/health` reports healthy and DB connected

## If something goes wrong

- [ ] Application: promote the last known-good deployment in Vercel - see [rollback.md](./rollback.md)
- [ ] Database: assess migration impact; compensation migration or restore per [backups.md](./backups.md)
- [ ] Confirm Sentry is not reporting a new error spike after deploy

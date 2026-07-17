# ADR-011: Continuous Delivery

## Status

Accepted

## Context

Alliance Command Center is preparing for its Founder Beta release. We need deployment practices that support:

- Fast iteration based on user feedback
- Safe, automated deployments
- Quick recovery from failures
- Observable production behavior

## Decision

### Core Principles

1. **Every merge to `main` is deployable**
   - All CI checks pass before merge
   - No manual steps required between merge and deploy
   - Feature flags control user-facing changes

2. **CI must pass before deployment**
   - Type checking
   - Linting
   - Unit tests
   - Integration tests
   - E2E tests
   - Accessibility tests

3. **Production deployments are automated**
   - Vercel deploys on merge to `main`
   - No manual deployment steps
   - Build includes `prisma generate` and `prisma migrate deploy`

4. **Rollback is documented and tested**
   - Vercel dashboard rollback for application
   - Database restore from backup for data issues
   - Rollback procedure tested before beta launch

5. **Database migrations are forward-only**
   - No automatic rollback support in Prisma
   - Compensation migrations for breaking changes
   - Test migrations against production-like data before deploy

6. **Deployments are observable**
   - Health endpoint at `/api/health`
   - Sentry for error tracking
   - Post-deploy smoke tests verify critical paths

### Deployment Pipeline

```
Pull Request
     │
     ▼
┌─────────────────────────────────────────┐
│              CI Checks                   │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐    │
│  │  Build  │ │  Lint   │ │  Types  │    │
│  └─────────┘ └─────────┘ └─────────┘    │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐    │
│  │  Unit   │ │  Integ  │ │   E2E   │    │
│  └─────────┘ └─────────┘ └─────────┘    │
│  ┌─────────┐ ┌─────────┐                │
│  │   A11y  │ │ Visual  │                │
│  └─────────┘ └─────────┘                │
└─────────────────────────────────────────┘
     │
     ▼ (all pass)
┌─────────────────────────────────────────┐
│            Merge to main                 │
└─────────────────────────────────────────┘
     │
     ▼ (automatic)
┌─────────────────────────────────────────┐
│           Vercel Build                   │
│  1. prisma generate                      │
│  2. prisma migrate deploy                │
│  3. next build                           │
└─────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────┐
│          Production Deploy               │
└─────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────┐
│         Post-Deploy Smoke Test           │
│  - /api/health responds healthy          │
│  - /login page loads                     │
│  - Database connection works             │
└─────────────────────────────────────────┘
```

### Quality Gates

Before deployment proceeds, these checks must pass:

| Check | Purpose |
|-------|---------|
| `npm run typecheck` | Type safety |
| `npm run lint` | Code quality |
| `npm run test:unit` | Business logic |
| `npm run test:integration` | Database operations |
| `npm run test:e2e` | User journeys |
| `npm run test:a11y` | Accessibility |

### Rollback Procedures

#### Application Rollback

1. Go to Vercel Dashboard > Deployments
2. Find last known-good deployment
3. Click "..." > "Promote to Production"
4. Verify health endpoint

#### Database Rollback

If a migration causes data issues:

1. Assess impact and decide on approach:
   - Minor: Write compensation migration
   - Major: Restore from backup

2. For backup restore:
   - Neon: Use point-in-time recovery
   - Supabase: Restore from daily backup
   - Document data loss window

3. Deploy compensation migration if needed

### Monitoring

- **Health:** `/api/health` endpoint
- **Errors:** Sentry captures exceptions
- **Uptime:** External monitoring (optional)

## Consequences

### Positive

- Fast feedback loop from users to production
- Reduced manual deployment errors
- Clear recovery procedures
- Observable production behavior

### Tradeoffs

- Requires discipline on feature flags
- No staging environment initially (Vercel preview deploys serve this purpose)
- Database rollback is manual and may involve data loss

### Not Included

These are intentionally deferred:

- Blue/green deployments
- Canary releases
- Automatic rollback on error spike
- Multi-region deployment

## Related Documents

- `docs/operations/rollback.md` - Detailed rollback procedures
- `docs/operations/backups.md` - Backup and restore procedures
- `docs/testing-strategy.md` - Testing requirements

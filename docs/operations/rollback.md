# Rollback Procedures

This document describes how to recover from failed deployments or database issues.

## Application Rollback

If a deployment causes application issues (errors, broken pages, etc.):

### Via Vercel Dashboard

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Select the Alliance Command Center project
3. Click "Deployments" tab
4. Find the last known-good deployment (green checkmark, worked before)
5. Click the "..." menu on that deployment
6. Select "Promote to Production"
7. Wait for promotion to complete (~30 seconds)
8. Verify `/api/health` returns healthy

### Via Vercel CLI

```bash
# List recent deployments
vercel ls

# Promote a specific deployment to production
vercel promote <deployment-url>
```

### Post-Rollback

1. Verify health endpoint: `curl https://your-domain.vercel.app/api/health`
2. Verify login page loads
3. Test critical user flows manually
4. Investigate the failed deployment before retrying

---

## Database Rollback

If a database migration causes data issues:

### Assessment

First, assess the impact:

- **Minor:** A few records affected, no data loss → Write compensation migration
- **Major:** Significant data corruption or loss → Restore from backup

### Option 1: Compensation Migration

For minor issues, write a new migration to fix the data:

```bash
# Create a new migration
npx prisma migrate dev --name fix_data_issue

# Edit the migration SQL to fix the data
# Then deploy
npx prisma migrate deploy
```

### Option 2: Restore from Backup

For major issues, restore from your database provider's backup.

#### Neon (Point-in-Time Recovery)

1. Go to Neon Console
2. Select your project
3. Click "Branches" → "Create Branch"
4. Select "From a point in time"
5. Choose timestamp before the issue
6. Create the branch
7. Update `DATABASE_URL` to point to the restored branch
8. Redeploy the application

#### Supabase (Daily Backups)

1. Go to Supabase Dashboard
2. Select your project
3. Go to "Database" → "Backups"
4. Find a backup from before the issue
5. Click "Restore"
6. Note: This replaces the current database

#### AWS RDS (Automated Backups)

1. Go to AWS RDS Console
2. Select your database
3. Actions → "Restore to point in time"
4. Choose the target time
5. Create a new database instance
6. Update `DATABASE_URL` to point to the restored instance
7. Redeploy the application

### Post-Restore

1. Verify data integrity
2. Document data loss window (if any)
3. Communicate to affected users
4. Investigate root cause before retrying migration

---

## Prevention

### Before Deploying Migrations

1. Test migration against a copy of production data
2. Review generated SQL carefully
3. Have a rollback plan ready
4. Consider deployment timing (avoid peak usage)

### Backups

- Verify backups are enabled on your provider
- Test restore procedure periodically
- See `docs/operations/backups.md` for details

---

## Emergency Contacts

During beta, contact:
- Primary: [Your contact method]
- Backup: [Alternate contact]

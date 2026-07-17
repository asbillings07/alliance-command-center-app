# Database Backups

This document describes backup configuration and restore procedures.

## Backup Configuration

Alliance Command Center uses managed PostgreSQL. Configure backups based on your provider:

### Neon

**Default:** Point-in-time recovery enabled (7-day retention)

No additional configuration needed. Neon automatically stores all changes.

**To verify:**
1. Go to Neon Console
2. Select your project
3. Check "Branches" tab - you can create branches from any point in time

### Supabase

**Default:** Daily backups on Pro plan

**To enable (if not on Pro):**
1. Go to Supabase Dashboard
2. Upgrade to Pro plan
3. Backups are enabled automatically

**To verify:**
1. Go to "Database" → "Backups"
2. Confirm daily backups are listed

### AWS RDS

**To configure:**
1. Go to RDS Console
2. Select your database
3. Modify → Backup section
4. Set backup retention period (7+ days recommended)
5. Enable automated backups

---

## Restore Testing

**Do not skip this.** Many companies discover their backups don't work when they need them.

### Pre-Beta Restore Test

Before launching beta:

1. **Create a test restore**
   - Neon: Create branch from 24 hours ago
   - Supabase: Restore backup to a new project
   - RDS: Restore to point in time

2. **Verify data integrity**
   ```sql
   -- Check record counts match expectations
   SELECT 
     (SELECT COUNT(*) FROM "User") as users,
     (SELECT COUNT(*) FROM "Alliance") as alliances,
     (SELECT COUNT(*) FROM "AllianceMember") as members;
   ```

3. **Test application connectivity**
   - Point a local app instance at the restored database
   - Verify login works
   - Verify data displays correctly

4. **Document the procedure**
   - Time taken to restore
   - Any issues encountered
   - Steps specific to your provider

### Periodic Testing

Test restore procedure monthly during beta:

- [ ] Restore completed successfully
- [ ] Data integrity verified
- [ ] Application connects successfully
- [ ] Procedure documented

---

## Backup Schedule

| Provider | Frequency | Retention | Type |
|----------|-----------|-----------|------|
| Neon | Continuous | 7 days | Point-in-time |
| Supabase | Daily | 7 days | Full snapshot |
| RDS | Daily + continuous | Configurable | Point-in-time |

---

## Recovery Time Objectives

During Founder Beta:

- **RTO (Recovery Time Objective):** 1 hour
- **RPO (Recovery Point Objective):** 24 hours

This means:
- We aim to restore service within 1 hour of an incident
- We accept up to 24 hours of data loss in worst case

As the product matures, these targets should tighten.

---

## Data Loss Communication

If data loss occurs:

1. Assess the scope (which alliances, what timeframe)
2. Document what was lost
3. Notify affected users directly
4. Explain what happened and what we're doing to prevent recurrence
5. Offer assistance recreating lost data if possible

---

## Related Documents

- `docs/operations/rollback.md` - Rollback procedures
- `docs/adr/011-continuous-delivery.md` - Deployment principles

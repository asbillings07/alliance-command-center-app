# ADR-012: Platform Bootstrap

## Status

Accepted

## Context

Alliance Command Center requires at least one platform administrator to operate. However, creating a platform admin requires access to the Platform Console, which itself requires platform admin authorization. This creates a circular dependency on fresh deployments.

Additionally, the original implementation stored platform admin status in environment variables (`PLATFORM_ADMIN_EMAILS`), which has several limitations:

- Adding or removing admins requires a deployment
- Environment variables are deployment configuration, not business data
- No audit trail of who granted admin status

## Decision

The platform supports a one-time initialization flow that separates **bootstrap authorization** from **runtime authorization**:

### Bootstrap Authorization (Day 0)

1. When no platform administrators exist in the database, `/initialize` is accessible
2. The initializing user must provide the deployment's `PLATFORM_BOOTSTRAP_SECRET` (proof of ownership)
3. The initializing user must provide an email from `PLATFORM_ADMIN_EMAILS` env var
4. The first user is created with `isPlatformAdmin: true` in the database
5. After successful initialization, `/initialize` is permanently disabled

Knowing an allowed email is not proof of ownership. Without a second factor, anyone
who guessed an email in `PLATFORM_ADMIN_EMAILS` could claim the first platform admin
account on a fresh deployment. The `PLATFORM_BOOTSTRAP_SECRET` is a deployment-only
value (never exposed to clients) that must be supplied on the `/initialize` form and
is compared in constant time. It is required in production; when unset, bootstrap is
refused in production (fail closed) and permitted without a secret only in
development/test for local convenience.

### Runtime Authorization (Day 1+)

1. Platform admin status is read from `User.isPlatformAdmin` in the database
2. `PLATFORM_ADMIN_EMAILS` is no longer consulted after initialization
3. Future platform admins can be added/removed via database operations
4. All administrative operations use the Platform Console

### Key Distinction: Operators vs. Founders

- **Bootstrap users** are operators who run the platform
- **Beta invitees** are founders who use the platform
- These are separate concepts with separate flows
- Bootstrap does NOT create a beta invitation for the operator

## Schema Changes

```prisma
model User {
  // ... existing fields
  isPlatformAdmin  Boolean   @default(false)
}

model BetaInvitation {
  // ... existing fields
  notes     String?    // Optional context for invitations
  revokedAt DateTime?  // Soft-delete for audit history
}
```

## Consequences

### Positive

- Fresh deployments have a clear initialization path
- No backdoors or weakened authorization after initialization
- Database owns platform admin status, not environment variables
- Platform admins can be added/removed without deployment changes
- Bootstrap flow runs once per platform instance
- Clear separation between operator and founder concepts

### Negative

- First admin must be in `PLATFORM_ADMIN_EMAILS` env var and know `PLATFORM_BOOTSTRAP_SECRET`
- No UI for managing platform admins (future work)
- If all platform admins are deleted, recovery requires database access

## Implementation Details

### Initialization Check

```typescript
export async function isPlatformInitialized(): Promise<boolean> {
  const adminCount = await prisma.user.count({
    where: { isPlatformAdmin: true },
  });
  return adminCount > 0;
}
```

### Bootstrap Validation

```typescript
export function canInitializePlatform(email: string): boolean {
  const allowedEmails = getBootstrapAllowedEmails();
  return allowedEmails.includes(email.toLowerCase());
}

export function verifyBootstrapSecret(
  providedSecret: string | undefined | null
): boolean {
  const expected = process.env.PLATFORM_BOOTSTRAP_SECRET?.trim();

  if (!expected) {
    // Fail closed in production; allow in dev/test for local convenience.
    return process.env.NODE_ENV !== "production";
  }

  const provided = providedSecret?.trim();
  if (!provided) return false;

  const expectedBuffer = Buffer.from(expected, "utf8");
  const providedBuffer = Buffer.from(provided, "utf8");
  if (expectedBuffer.length !== providedBuffer.length) return false;

  return timingSafeEqual(expectedBuffer, providedBuffer);
}
```

### Runtime Authorization

```typescript
export async function requirePlatformAdmin() {
  const session = await requireAuth();
  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: { isPlatformAdmin: true },
  });

  if (!user?.isPlatformAdmin) {
    redirect("/app");
  }

  return session;
}
```

## Migration Guide (Existing Deployments)

When upgrading from environment-variable-based authorization to database-based authorization:

1. **Deploy the migration** - This adds `isPlatformAdmin` (defaults to `false`)

2. **Run the backfill script** IMMEDIATELY after migration:
   ```bash
   npx tsx scripts/backfill-platform-admins.ts
   ```
   
   This script reads `PLATFORM_ADMIN_EMAILS` and sets `isPlatformAdmin: true` for matching users.

3. **Verify access** - Confirm existing admins can access `/platform`

**Warning**: If you skip the backfill:
- All users will have `isPlatformAdmin: false`
- `/initialize` will become accessible again
- Existing admins will lose Platform Console access

The backfill script is idempotent and safe to run multiple times.

## Related ADRs

- ADR-010: Platform Operations Architecture

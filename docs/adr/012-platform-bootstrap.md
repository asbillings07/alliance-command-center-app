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
2. The initializing user must provide an email from `PLATFORM_ADMIN_EMAILS` env var
3. The first user is created with `isPlatformAdmin: true` in the database
4. After successful initialization, `/initialize` is permanently disabled

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

- First admin must be in `PLATFORM_ADMIN_EMAILS` env var
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

## Related ADRs

- ADR-010: Platform Operations Architecture

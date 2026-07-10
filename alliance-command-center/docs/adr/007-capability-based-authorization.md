# ADR-007: Capability-Based Authorization

## Status

Accepted

## Context

Alliance Command Center supports collaboration through invitations and authenticated leadership accounts. The next step is to control what each collaborator is allowed to do.

Prior to this decision, authorization was implemented through scattered role comparisons:

```typescript
if (membership.role === "OWNER" || membership.role === "ADMIN") {
  // allow action
}
```

This approach had several problems:

1. **Role knowledge spread throughout the codebase** - Business logic knew which roles granted which permissions
2. **No single source of truth** - The same role check was duplicated in multiple places
3. **Difficult to audit** - Understanding what a role could do required searching the entire codebase
4. **Fragile refactoring** - Adding a new role or changing permissions required updating every check

We needed an authorization model that:

- Models responsibilities, not technical roles
- Centralizes permission definitions
- Allows business logic to ask "can this user do X?" without knowing which roles enable X
- Supports the natural alliance leadership hierarchy (Owner > Admin > Leader > Viewer)

## Decision

We implement a **capability-based authorization architecture** with the following components:

### 1. Permission Constants

All permissions are defined as constants in a single location:

```typescript
export const Permissions = {
  VIEW_ALLIANCE: "view:alliance",
  MANAGE_MEMBERS: "manage:members",
  INVITE_COLLABORATORS: "invite:collaborators",
  // ...
} as const;
```

Business logic uses these constants instead of raw strings, providing autocomplete, typo protection, and easier refactoring.

### 2. Role-Centric Permission Matrix

Permissions are mapped from roles, not the reverse:

```typescript
const ROLE_PERMISSIONS: Record<AllianceRole, Permission[]> = {
  VIEWER: ["view:alliance", "view:members", "view:notes"],
  LEADER: [...VIEWER_PERMS, "manage:notes", "import:metrics"],
  ADMIN: [...LEADER_PERMS, "manage:members", "configure:metrics", ...],
  OWNER: [...ADMIN_PERMS, "manage:leadership", "manage:alliance"],
};
```

This answers the question "what can this role do?" rather than "who has this permission?".

### 3. Permissions Resolved Once

The `buildPermissionSet(role)` function evaluates the role matrix exactly once and returns a `PermissionSet` with boolean flags:

```typescript
type PermissionSet = {
  canViewAlliance: boolean;
  canManageMembers: boolean;
  canInviteCollaborators: boolean;
  // ...
};
```

All subsequent authorization checks operate on this resolved set. The role is never re-evaluated.

### 4. AuthorizationContext

Every page and server action receives an `AuthorizationContext`:

```typescript
type AuthorizationContext = {
  user: { id: string; email: string };
  membership: AllianceMembership;
  permissions: PermissionSet;
};
```

This is obtained through a unified entry point:

```typescript
const auth = await requireAllianceAccess({
  allianceId,
  requiredPermission: Permissions.MANAGE_MEMBERS,
});
```

### 5. UI Never Compares Roles

Components receive `permissions` and check capability flags:

```typescript
// Good
{permissions.canManageMembers && <EditButton />}

// Bad - UI should not know about roles
{membership.role === "ADMIN" && <EditButton />}
```

## Layered Architecture

```
Authentication     →  Who are you?           →  requireAuth()
       ↓
Authorization      →  What can you do?       →  requireAllianceAccess()
       ↓
Business Logic     →  What should happen?    →  createMember()
       ↓
Persistence        →  How is it stored?      →  Prisma
```

## Consequences

### Positive

- **Single source of truth** - All permission definitions in one file
- **Auditable** - Easy to see what each role can do by reading the matrix
- **Type-safe** - Permission constants provide compile-time checking
- **Consistent patterns** - Every page and action follows the same authorization flow
- **UI/Business logic separation** - UI only knows about capabilities, not roles
- **Extensible** - New permissions or roles can be added by extending the matrix

### Negative

- **Migration effort** - Existing code must be updated to use the new patterns
- **Learning curve** - Contributors must understand the capability-based approach
- **Slight overhead** - Building the permission set adds a small amount of work per request

### Neutral

- Permissions are not user-configurable (intentional simplicity for MVP)
- Custom roles are not supported (can be added later by extending the matrix)

## Future Considerations

Not part of this decision, but the architecture supports:

- `export:reports` permission for R5s exporting season summaries
- Custom roles by extending `ROLE_PERMISSIONS`
- Fine-grained permission editing per user
- Audit logs for permission changes
- Temporary/time-limited permissions

## References

- `app/src/lib/auth/permissions.ts` - Permission service implementation
- `app/src/lib/auth/requireAllianceAccess.ts` - Authorization entry point
- `app/src/lib/auth/permissions.test.ts` - Permission service tests

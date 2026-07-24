# Alliance Command Center Authorization Matrix

**Last Updated:** 2026-07-23  
**Purpose:** Document exact current ACC permission model before implementing #182

## Executive Summary

Alliance Command Center uses a **4-role permission system** entirely independent of in-game Last War rank. The `AllianceMember.role` field (e.g., "R4", "Officer") is optional descriptive metadata with no authorization significance.

**No in-game rank is stored, queried, or used for authorization decisions.**

---

## ACC Roles

Defined in `prisma/schema.prisma` as `AllianceRole` enum:

- `OWNER` - Full alliance control
- `ADMIN` - Day-to-day operations (cannot transfer ownership or delete alliance)
- `LEADER` - Evaluation workflow (notes, metrics, period management)
- `VIEWER` - Read-only access

---

## Permission Matrix

Implementation: `app/src/lib/auth/permissions.ts`

| Permission | OWNER | ADMIN | LEADER | VIEWER | Notes |
|------------|-------|-------|--------|--------|-------|
| **View alliance** | ✓ | ✓ | ✓ | ✓ | Dashboard, settings |
| **View members** | ✓ | ✓ | ✓ | ✓ | Roster, member details |
| **View notes** | ✓ | ✓ | ✓ | ✓ | Leadership notes |
| **Manage notes** | ✓ | ✓ | ✓ | ✗ | Add/edit leadership notes |
| **Import metrics** | ✓ | ✓ | ✓ | ✗ | Import metric data |
| **Manage members** | ✓ | ✓ | ✗ | ✗ | Add/archive/restore members |
| **Import members** | ✓ | ✓ | ✗ | ✗ | Bulk roster import |
| **Configure metrics** | ✓ | ✓ | ✗ | ✗ | Create/edit metric definitions |
| **Configure periods** | ✓ | ✓ | ✓ | ✗ | Create/manage evaluation periods |
| **Invite collaborators** | ✓ | ✓ | ✗ | ✗ | Send alliance invitations |
| **Manage leadership** | ✓ | ✗ | ✗ | ✗ | Change user roles |
| **Manage alliance** | ✓ | ✗ | ✗ | ✗ | Delete alliance |

---

## Onboarding & Setup

**Source:** `app/src/lib/createAlliance.ts`, `app/src/lib/allianceSetup.ts`

### Alliance Creation

When a user accepts a beta invitation and creates an alliance:
1. `Alliance` record created
2. `AllianceMembership` created with role `OWNER`
3. **No rank is required or consulted**

### Setup Flow

Setup tasks are **alliance-scoped** (not user-scoped) and can be completed by any user with sufficient permissions:

| Setup Task | Required | Permission | Min Role |
|------------|----------|------------|----------|
| Configure Metrics | ✓ | `canConfigureMetrics` | ADMIN |
| Create Evaluation Period | ✓ | `canConfigurePeriods` | LEADER |
| Invite Leadership Team | ✓ | `canInviteCollaborators` | ADMIN |
| Import Members | ✗ | `canImportMembers` | ADMIN |
| Import First Dataset | ✗ | `canImportMetrics` | LEADER |

**Setup completion is based on task completion state, not user identity.**

A LEADER can complete "Create Evaluation Period" even if they didn't create the alliance. An ADMIN invited by the founding operator can complete metrics configuration and member import.

---

## Authorization Flow

**Source:** `app/src/lib/auth/requireAllianceAccess.ts`

```
User Request
    ↓
requireAuth() → User
    ↓
Load AllianceMembership by (allianceId, userId)
    ↓
membership.role → buildPermissionSet(role) → PermissionSet
    ↓
hasPermission(permissions, requiredPermission) → boolean
    ↓
Grant or Deny
```

**Authorization is enforced on every server action and protected page.**

---

## Role Assignment

### Initial Owner

- Automatically granted `OWNER` role when creating alliance (via `createAlliance()`)
- No rank check performed

### Invited Users

**Source:** `app/alliances/[allianceId]/settings/invitations`

Current implementation:
- Invited users receive `OWNER` role by default (via `AllianceMembership.create()`)
- **This is a known limitation** - all invited users become owners

**Issue #182 Decision:**
- The product intent is for invited leadership to have appropriate collaboration roles (ADMIN/LEADER)
- Current behavior grants full OWNER permissions to all invited users
- **Recommendation:** #182 should focus on language/semantics corrections and rank independence verification, NOT introduce role selection UI

---

## In-Game Rank

**Storage:** `AllianceMember.role` (TEXT, nullable)

This field:
- Stores optional descriptive text like "R5", "R4", "Officer"
- Has **no foreign keys, no enum, no authorization significance**
- Is **never queried for permission checks**
- Is display-only metadata

---

## Findings for Issue #182

### What Works Today

✓ Authorization is entirely ACC-role-based  
✓ No in-game rank is consulted anywhere  
✓ Setup is alliance-scoped and continuable by authorized users  
✓ Permission system is well-structured and complete

### Semantic Issues to Fix

1. **Setup task language**: `typicallyCompletedBy: "Owner"` could be misread as "R5 Owner"
   - Should be: `"Founding Operator"` or `"Alliance Owner"` (ACC role)

2. **Platform Console**: May use "owner" language that implies R5
   - Audit: `/platform/beta/*` pages

3. **Invitation flow**: Current grants OWNER to all invited users
   - Document as known behavior
   - Role selection is separate feature work

### Verification Needed

- [ ] E2E test: Alliance created by user with beta invitation (no rank required)
- [ ] E2E test: ADMIN-role user can complete setup tasks
- [ ] E2E test: LEADER-role user can complete period creation
- [ ] Audit: Platform Console copy for "owner" → "workspace" language

---

## Implementation Scope for #182

**In Scope:**
1. Update `typicallyCompletedBy` language in `allianceSetup.ts` to clarify ACC roles
2. Audit and update Platform Console terminology
3. Add E2E test proving rank independence
4. Document role assignment behavior

**Out of Scope:**
1. Role selection UI for invited users (separate feature)
2. Changing how invited users receive roles (separate feature)
3. Adding rank storage or rank-based auth (explicitly not desired)

---

## Notes

- ACC's permission model is correctly designed and implemented
- #182 is primarily a **language/terminology** correction, not an authorization refactor
- The E2E test should be named "Founding operator onboarding" (ACC doesn't store rank to manufacture R4)

# Alliance Command Center Authorization Matrix

**Last Updated:** 2026-07-23  
**Purpose:** Document exact current ACC permission model before implementing #182

## Executive Summary

Alliance Command Center uses a **4-role permission system** entirely independent of in-game Last War rank. The `AllianceMember.role` field (e.g., "R4", "Officer") is optional descriptive metadata with no authorization significance.

**In-game rank may be stored as optional roster metadata but is never queried or used for authorization decisions.**

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
| **Import evaluation results** | ✓ | ✓ | ✓ | ✗ | Import evaluation metric data |
| **Manage members** | ✓ | ✓ | ✗ | ✗ | Add/archive/restore members |
| **Import roster** | ✓ | ✓ | ✗ | ✗ | Bulk roster import |
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
| Import Roster | ✗ | `canImportMembers` | ADMIN |
| Import Evaluation Results | ✗ | `canImportMetrics` | LEADER |

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

**Source:** `app/alliances/[allianceId]/settings/invitations`, `app/invite/[token]/action.ts`

Current implementation:
1. Invitation form captures `membershipRole`: `ADMIN`, `LEADER`, or `VIEWER` (defaults to `LEADER`)
2. `Invitation` record stores selected `membershipRole`
3. On acceptance, `AllianceMembership` created with `role: invitation.membershipRole` (line 93 of `action.ts`)
4. **Invited users receive exactly the role specified in their invitation**

Only the founding operator (alliance creator) receives `OWNER` role automatically.

**Implication for #182:**
- Role assignment already works correctly
- Invited users do NOT become OWNER
- Only semantic/language clarifications remain

---

## In-Game Rank (Descriptive Metadata Only)

**Storage:** `AllianceMember.role` (TEXT, nullable)

In-game rank **is stored** as optional descriptive metadata, but:
- Stored as free-form text like "R5", "R4", "Officer", "Member"
- Has **no foreign keys, no enum constraint, zero authorization significance**
- Is **never queried for permission checks or conditional logic**
- Serves only as display-only roster metadata
- Cannot influence ACC authorization in any way

ACC authorization uses `AllianceMembership.role` (OWNER/ADMIN/LEADER/VIEWER enum).  
In-game rank uses `AllianceMember.role` (nullable text field).  
These are separate, unrelated fields with similar names.

---

## Findings for Issue #182

### What Works Today

✓ Authorization is entirely ACC-role-based  
✓ In-game rank is stored as optional roster metadata but never used for authorization  
✓ Setup is alliance-scoped and continuable by authorized users  
✓ Permission system is well-structured and complete

### Semantic Issues to Fix

1. **Setup task language**: `typicallyCompletedBy: "Owner"` could be misread as "R5 Owner"
   - Fixed to: `"Founding Operator"` (onboarding persona, not an ACC role)
   - Clarifies this refers to the user creating the workspace, not game rank
   - **Note**: "Founding Operator" is a label describing a typical use case, not a fifth ACC role
   - ACC roles remain: OWNER, ADMIN, LEADER, VIEWER

2. **Platform Console**: May use "owner" language that could be misread as R5
   - Audit: `/platform/beta/*` pages for workspace ownership terminology

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
1. Changing role assignment mechanics (already correct)
2. Adding rank storage or rank-based auth (explicitly not desired)
3. Authorization refactor (current model is correct)

---

## Notes

- ACC's permission model is correctly designed and implemented
- #182 is primarily a **language/terminology** correction, not an authorization refactor
- The E2E test should be named "Founding operator onboarding" (ACC doesn't store rank to manufacture R4)

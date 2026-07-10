import { AllianceRole } from "@/app/generated/prisma/enums";
import type { AllianceMembership } from "@/app/generated/prisma/client";

/**
 * Permission constants - use these instead of raw strings throughout the application.
 * Provides autocomplete, typo protection, and easier refactoring.
 */
export const Permissions = {
  VIEW_ALLIANCE: "view:alliance",
  VIEW_MEMBERS: "view:members",
  VIEW_NOTES: "view:notes",
  MANAGE_NOTES: "manage:notes",
  IMPORT_METRICS: "import:metrics",
  MANAGE_MEMBERS: "manage:members",
  IMPORT_MEMBERS: "import:members",
  CONFIGURE_METRICS: "configure:metrics",
  CONFIGURE_PERIODS: "configure:periods",
  INVITE_COLLABORATORS: "invite:collaborators",
  MANAGE_LEADERSHIP: "manage:leadership",
  MANAGE_ALLIANCE: "manage:alliance",
} as const;

export type Permission = (typeof Permissions)[keyof typeof Permissions];

/**
 * Role-centric permission matrix.
 * Answers the question: "What can this role do?"
 */
const ROLE_PERMISSIONS: Record<AllianceRole, Permission[]> = {
  [AllianceRole.VIEWER]: [
    Permissions.VIEW_ALLIANCE,
    Permissions.VIEW_MEMBERS,
    Permissions.VIEW_NOTES,
  ],

  [AllianceRole.LEADER]: [
    Permissions.VIEW_ALLIANCE,
    Permissions.VIEW_MEMBERS,
    Permissions.VIEW_NOTES,
    Permissions.MANAGE_NOTES,
    Permissions.IMPORT_METRICS,
    Permissions.CONFIGURE_PERIODS,
  ],

  [AllianceRole.ADMIN]: [
    Permissions.VIEW_ALLIANCE,
    Permissions.VIEW_MEMBERS,
    Permissions.VIEW_NOTES,
    Permissions.MANAGE_NOTES,
    Permissions.IMPORT_METRICS,
    Permissions.MANAGE_MEMBERS,
    Permissions.IMPORT_MEMBERS,
    Permissions.CONFIGURE_METRICS,
    Permissions.CONFIGURE_PERIODS,
    Permissions.INVITE_COLLABORATORS,
  ],

  [AllianceRole.OWNER]: [
    Permissions.VIEW_ALLIANCE,
    Permissions.VIEW_MEMBERS,
    Permissions.VIEW_NOTES,
    Permissions.MANAGE_NOTES,
    Permissions.IMPORT_METRICS,
    Permissions.MANAGE_MEMBERS,
    Permissions.IMPORT_MEMBERS,
    Permissions.CONFIGURE_METRICS,
    Permissions.CONFIGURE_PERIODS,
    Permissions.INVITE_COLLABORATORS,
    Permissions.MANAGE_LEADERSHIP,
    Permissions.MANAGE_ALLIANCE,
  ],
};

/**
 * Resolved permission set - boolean flags for each capability.
 * Built once from a role and passed throughout the application.
 */
export type PermissionSet = {
  canViewAlliance: boolean;
  canViewMembers: boolean;
  canViewNotes: boolean;
  canManageNotes: boolean;
  canImportMetrics: boolean;
  canManageMembers: boolean;
  canImportMembers: boolean;
  canConfigureMetrics: boolean;
  canConfigurePeriods: boolean;
  canInviteCollaborators: boolean;
  canManageLeadership: boolean;
  canManageAlliance: boolean;
};

/**
 * The authorization context passed to pages and server actions.
 * Contains everything needed for authorization decisions.
 */
export type AuthorizationContext = {
  user: { id: string; email: string };
  membership: AllianceMembership;
  permissions: PermissionSet;
};

/**
 * Build a PermissionSet from a role.
 * The role matrix is evaluated exactly once here.
 * All subsequent checks operate on the resolved PermissionSet.
 * Unknown roles default to no permissions (deny by default).
 */
export function buildPermissionSet(role: AllianceRole): PermissionSet {
  const rolePerms = ROLE_PERMISSIONS[role] ?? [];

  return {
    canViewAlliance: rolePerms.includes(Permissions.VIEW_ALLIANCE),
    canViewMembers: rolePerms.includes(Permissions.VIEW_MEMBERS),
    canViewNotes: rolePerms.includes(Permissions.VIEW_NOTES),
    canManageNotes: rolePerms.includes(Permissions.MANAGE_NOTES),
    canImportMetrics: rolePerms.includes(Permissions.IMPORT_METRICS),
    canManageMembers: rolePerms.includes(Permissions.MANAGE_MEMBERS),
    canImportMembers: rolePerms.includes(Permissions.IMPORT_MEMBERS),
    canConfigureMetrics: rolePerms.includes(Permissions.CONFIGURE_METRICS),
    canConfigurePeriods: rolePerms.includes(Permissions.CONFIGURE_PERIODS),
    canInviteCollaborators: rolePerms.includes(Permissions.INVITE_COLLABORATORS),
    canManageLeadership: rolePerms.includes(Permissions.MANAGE_LEADERSHIP),
    canManageAlliance: rolePerms.includes(Permissions.MANAGE_ALLIANCE),
  };
}

/**
 * Mapping from Permission constant to PermissionSet property name.
 * Used by hasPermission to check the resolved set.
 */
const PERMISSION_TO_KEY: Record<Permission, keyof PermissionSet> = {
  [Permissions.VIEW_ALLIANCE]: "canViewAlliance",
  [Permissions.VIEW_MEMBERS]: "canViewMembers",
  [Permissions.VIEW_NOTES]: "canViewNotes",
  [Permissions.MANAGE_NOTES]: "canManageNotes",
  [Permissions.IMPORT_METRICS]: "canImportMetrics",
  [Permissions.MANAGE_MEMBERS]: "canManageMembers",
  [Permissions.IMPORT_MEMBERS]: "canImportMembers",
  [Permissions.CONFIGURE_METRICS]: "canConfigureMetrics",
  [Permissions.CONFIGURE_PERIODS]: "canConfigurePeriods",
  [Permissions.INVITE_COLLABORATORS]: "canInviteCollaborators",
  [Permissions.MANAGE_LEADERSHIP]: "canManageLeadership",
  [Permissions.MANAGE_ALLIANCE]: "canManageAlliance",
};

/**
 * Check if a permission is granted in the resolved PermissionSet.
 * Use this instead of checking the role directly.
 * Unknown permissions default to false (deny by default).
 */
export function hasPermission(
  permissions: PermissionSet,
  permission: Permission
): boolean {
  const key = PERMISSION_TO_KEY[permission];
  if (!key) {
    return false;
  }
  return permissions[key];
}

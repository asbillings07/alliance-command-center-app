import { describe, it, expect } from "vitest";
import {
  Permissions,
  buildPermissionSet,
  hasPermission,
  PermissionSet,
} from "./permissions";

// Match Prisma-generated AllianceRole values for testing
const AllianceRole = {
  OWNER: "OWNER",
  ADMIN: "ADMIN",
  LEADER: "LEADER",
  VIEWER: "VIEWER",
} as const;

type AllianceRole = (typeof AllianceRole)[keyof typeof AllianceRole];

describe("permissions", () => {
  describe("buildPermissionSet", () => {
    describe("OWNER", () => {
      it("has all permissions", () => {
        const permissions = buildPermissionSet(AllianceRole.OWNER);

        expect(permissions.canViewAlliance).toBe(true);
        expect(permissions.canViewMembers).toBe(true);
        expect(permissions.canViewNotes).toBe(true);
        expect(permissions.canManageNotes).toBe(true);
        expect(permissions.canImportMetrics).toBe(true);
        expect(permissions.canManageMembers).toBe(true);
        expect(permissions.canImportMembers).toBe(true);
        expect(permissions.canConfigureMetrics).toBe(true);
        expect(permissions.canConfigurePeriods).toBe(true);
        expect(permissions.canInviteCollaborators).toBe(true);
        expect(permissions.canManageLeadership).toBe(true);
        expect(permissions.canManageAlliance).toBe(true);
      });
    });

    describe("ADMIN", () => {
      it("has operational permissions", () => {
        const permissions = buildPermissionSet(AllianceRole.ADMIN);

        expect(permissions.canViewAlliance).toBe(true);
        expect(permissions.canViewMembers).toBe(true);
        expect(permissions.canViewNotes).toBe(true);
        expect(permissions.canManageNotes).toBe(true);
        expect(permissions.canImportMetrics).toBe(true);
        expect(permissions.canManageMembers).toBe(true);
        expect(permissions.canImportMembers).toBe(true);
        expect(permissions.canConfigureMetrics).toBe(true);
        expect(permissions.canConfigurePeriods).toBe(true);
        expect(permissions.canInviteCollaborators).toBe(true);
      });

      it("does not have owner-only permissions", () => {
        const permissions = buildPermissionSet(AllianceRole.ADMIN);

        expect(permissions.canManageLeadership).toBe(false);
        expect(permissions.canManageAlliance).toBe(false);
      });
    });

    describe("LEADER", () => {
      it("has day-to-day leadership permissions", () => {
        const permissions = buildPermissionSet(AllianceRole.LEADER);

        expect(permissions.canViewAlliance).toBe(true);
        expect(permissions.canViewMembers).toBe(true);
        expect(permissions.canViewNotes).toBe(true);
        expect(permissions.canManageNotes).toBe(true);
        expect(permissions.canImportMetrics).toBe(true);
        expect(permissions.canConfigurePeriods).toBe(true);
      });

      it("does not have admin permissions", () => {
        const permissions = buildPermissionSet(AllianceRole.LEADER);

        expect(permissions.canManageMembers).toBe(false);
        expect(permissions.canImportMembers).toBe(false);
        expect(permissions.canConfigureMetrics).toBe(false);
        expect(permissions.canInviteCollaborators).toBe(false);
        expect(permissions.canManageLeadership).toBe(false);
        expect(permissions.canManageAlliance).toBe(false);
      });
    });

    describe("VIEWER", () => {
      it("has only view permissions", () => {
        const permissions = buildPermissionSet(AllianceRole.VIEWER);

        expect(permissions.canViewAlliance).toBe(true);
        expect(permissions.canViewMembers).toBe(true);
        expect(permissions.canViewNotes).toBe(true);
      });

      it("cannot modify data", () => {
        const permissions = buildPermissionSet(AllianceRole.VIEWER);

        expect(permissions.canManageNotes).toBe(false);
        expect(permissions.canImportMetrics).toBe(false);
        expect(permissions.canManageMembers).toBe(false);
        expect(permissions.canImportMembers).toBe(false);
        expect(permissions.canConfigureMetrics).toBe(false);
        expect(permissions.canConfigurePeriods).toBe(false);
        expect(permissions.canInviteCollaborators).toBe(false);
        expect(permissions.canManageLeadership).toBe(false);
        expect(permissions.canManageAlliance).toBe(false);
      });
    });
  });

  describe("hasPermission", () => {
    it("returns true when permission is granted", () => {
      const permissions = buildPermissionSet(AllianceRole.ADMIN);

      expect(hasPermission(permissions, Permissions.MANAGE_MEMBERS)).toBe(true);
      expect(hasPermission(permissions, Permissions.CONFIGURE_METRICS)).toBe(true);
      expect(hasPermission(permissions, Permissions.INVITE_COLLABORATORS)).toBe(true);
    });

    it("returns false when permission is not granted", () => {
      const permissions = buildPermissionSet(AllianceRole.ADMIN);

      expect(hasPermission(permissions, Permissions.MANAGE_LEADERSHIP)).toBe(false);
      expect(hasPermission(permissions, Permissions.MANAGE_ALLIANCE)).toBe(false);
    });

    it("works correctly for all permission types", () => {
      const ownerPerms = buildPermissionSet(AllianceRole.OWNER);
      const viewerPerms = buildPermissionSet(AllianceRole.VIEWER);

      // Owner has all permissions
      expect(hasPermission(ownerPerms, Permissions.VIEW_ALLIANCE)).toBe(true);
      expect(hasPermission(ownerPerms, Permissions.MANAGE_ALLIANCE)).toBe(true);

      // Viewer only has view permissions
      expect(hasPermission(viewerPerms, Permissions.VIEW_ALLIANCE)).toBe(true);
      expect(hasPermission(viewerPerms, Permissions.MANAGE_NOTES)).toBe(false);
    });
  });

  describe("Permission constants", () => {
    it("exports all expected permission constants", () => {
      expect(Permissions.VIEW_ALLIANCE).toBe("view:alliance");
      expect(Permissions.VIEW_MEMBERS).toBe("view:members");
      expect(Permissions.VIEW_NOTES).toBe("view:notes");
      expect(Permissions.MANAGE_NOTES).toBe("manage:notes");
      expect(Permissions.IMPORT_METRICS).toBe("import:metrics");
      expect(Permissions.MANAGE_MEMBERS).toBe("manage:members");
      expect(Permissions.IMPORT_MEMBERS).toBe("import:members");
      expect(Permissions.CONFIGURE_METRICS).toBe("configure:metrics");
      expect(Permissions.CONFIGURE_PERIODS).toBe("configure:periods");
      expect(Permissions.INVITE_COLLABORATORS).toBe("invite:collaborators");
      expect(Permissions.MANAGE_LEADERSHIP).toBe("manage:leadership");
      expect(Permissions.MANAGE_ALLIANCE).toBe("manage:alliance");
    });
  });

  describe("role hierarchy validation", () => {
    it("every role with IMPORT_METRICS also has VIEW_ALLIANCE and VIEW_MEMBERS", () => {
      const roles = [
        AllianceRole.OWNER,
        AllianceRole.ADMIN,
        AllianceRole.LEADER,
        AllianceRole.VIEWER,
      ];

      for (const role of roles) {
        const perms = buildPermissionSet(role);
        if (perms.canImportMetrics) {
          expect(perms.canViewAlliance).toBe(true);
          expect(perms.canViewMembers).toBe(true);
        }
      }
    });

    it("OWNER > ADMIN > LEADER > VIEWER in terms of permissions", () => {
      const ownerPerms = buildPermissionSet(AllianceRole.OWNER);
      const adminPerms = buildPermissionSet(AllianceRole.ADMIN);
      const leaderPerms = buildPermissionSet(AllianceRole.LEADER);
      const viewerPerms = buildPermissionSet(AllianceRole.VIEWER);

      const countTrue = (perms: PermissionSet) =>
        Object.values(perms).filter(Boolean).length;

      expect(countTrue(ownerPerms)).toBe(12); // All 12 permissions
      expect(countTrue(adminPerms)).toBe(10); // All except manage:leadership and manage:alliance
      expect(countTrue(leaderPerms)).toBe(6);  // view:* + manage:notes + import:metrics + configure:periods
      expect(countTrue(viewerPerms)).toBe(3);  // Only view:*
    });
  });

  describe("deny by default", () => {
    it("buildPermissionSet returns no permissions for unknown role", () => {
      // Cast to bypass TypeScript - simulates runtime unknown role
      const unknownRole = "UNKNOWN_ROLE" as typeof AllianceRole.OWNER;
      const permissions = buildPermissionSet(unknownRole);

      const countTrue = (perms: PermissionSet) =>
        Object.values(perms).filter(Boolean).length;

      expect(countTrue(permissions)).toBe(0);
    });

    it("hasPermission returns false for unknown permission", () => {
      const permissions = buildPermissionSet(AllianceRole.OWNER);
      
      // Cast to bypass TypeScript - simulates runtime unknown permission
      const unknownPermission = "unknown:permission" as typeof Permissions.VIEW_ALLIANCE;
      
      expect(hasPermission(permissions, unknownPermission)).toBe(false);
    });
  });
});

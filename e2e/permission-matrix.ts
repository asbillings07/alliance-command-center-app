/**
 * Permission Matrix Test Fixture
 *
 * Defines the expected permissions for each role across all features.
 * Used to validate that the UI correctly reflects the permission system.
 *
 * Legend:
 *   true  = Feature should be accessible/visible
 *   false = Feature should be hidden/redirected
 */

export type Role = "OWNER" | "ADMIN" | "LEADER" | "VIEWER";

export type FeaturePermission = {
  /** Feature identifier */
  feature: string;
  /** Human-readable description */
  description: string;
  /** How to verify this permission in the UI */
  verification:
    | { type: "page_accessible"; path: string }
    | { type: "link_visible"; selector: string; onPage: string }
    | { type: "button_visible"; selector: string; onPage: string }
    | { type: "form_functional"; selector: string; onPage: string };
  /** Expected result per role */
  expected: Record<Role, boolean>;
};

/**
 * The complete permission matrix.
 *
 * This is the single source of truth for what each role can do.
 * If a test fails, either the code is wrong or this matrix needs updating.
 */
export const PERMISSION_MATRIX: FeaturePermission[] = [
  // ============================================================
  // Dashboard Navigation
  // ============================================================
  {
    feature: "dashboard.view",
    description: "Can view alliance dashboard",
    verification: {
      type: "page_accessible",
      path: "/alliances/{allianceId}",
    },
    expected: { OWNER: true, ADMIN: true, LEADER: true, VIEWER: true },
  },
  {
    feature: "dashboard.metrics_link",
    description: "Metrics Library link visible on dashboard",
    verification: {
      type: "link_visible",
      selector: 'a:has-text("Metrics Library")',
      onPage: "/alliances/{allianceId}",
    },
    expected: { OWNER: true, ADMIN: true, LEADER: false, VIEWER: false },
  },
  {
    feature: "dashboard.periods_link",
    description: "Evaluation Periods link visible on dashboard",
    verification: {
      type: "link_visible",
      selector: 'a:has-text("Evaluation Periods")',
      onPage: "/alliances/{allianceId}",
    },
    expected: { OWNER: true, ADMIN: true, LEADER: false, VIEWER: false },
  },
  {
    feature: "dashboard.team_link",
    description: "Leadership Team link visible on dashboard",
    verification: {
      type: "link_visible",
      selector: 'a:has-text("Leadership Team")',
      onPage: "/alliances/{allianceId}",
    },
    expected: { OWNER: true, ADMIN: true, LEADER: false, VIEWER: false },
  },
  {
    feature: "dashboard.record_link",
    description: "Record Metrics link visible on dashboard (for Leaders)",
    verification: {
      type: "link_visible",
      selector: 'a:has-text("Record Metrics")',
      onPage: "/alliances/{allianceId}",
    },
    expected: { OWNER: false, ADMIN: false, LEADER: true, VIEWER: false },
  },

  // ============================================================
  // Members
  // ============================================================
  {
    feature: "members.view",
    description: "Can view members roster",
    verification: {
      type: "page_accessible",
      path: "/alliances/{allianceId}/members",
    },
    expected: { OWNER: true, ADMIN: true, LEADER: true, VIEWER: true },
  },
  {
    feature: "members.add_button",
    description: "Add Member button visible",
    verification: {
      type: "link_visible",
      selector: 'a:has-text("Add Member")',
      onPage: "/alliances/{allianceId}/members",
    },
    expected: { OWNER: true, ADMIN: true, LEADER: false, VIEWER: false },
  },
  {
    feature: "members.import_link",
    description: "Import Members link visible",
    verification: {
      type: "link_visible",
      selector: 'a:has-text("Import")',
      onPage: "/alliances/{allianceId}/members",
    },
    expected: { OWNER: true, ADMIN: true, LEADER: false, VIEWER: false },
  },
  {
    feature: "members.detail",
    description: "Can view member detail page",
    verification: {
      type: "page_accessible",
      path: "/alliances/{allianceId}/members/{memberId}",
    },
    expected: { OWNER: true, ADMIN: true, LEADER: true, VIEWER: true },
  },

  // ============================================================
  // Metrics Configuration
  // ============================================================
  {
    feature: "metrics.configure",
    description: "Can access metrics configuration page",
    verification: {
      type: "page_accessible",
      path: "/alliances/{allianceId}/metrics",
    },
    expected: { OWNER: true, ADMIN: true, LEADER: false, VIEWER: false },
  },
  {
    feature: "metrics.create_button",
    description: "Create Metric button visible",
    verification: {
      type: "button_visible",
      selector: 'button:has-text("Create Metric")',
      onPage: "/alliances/{allianceId}/metrics",
    },
    expected: { OWNER: true, ADMIN: true, LEADER: false, VIEWER: false },
  },

  // ============================================================
  // Periods Configuration
  // ============================================================
  {
    feature: "periods.configure",
    description: "Can access periods configuration page",
    verification: {
      type: "page_accessible",
      path: "/alliances/{allianceId}/periods",
    },
    expected: { OWNER: true, ADMIN: true, LEADER: false, VIEWER: false },
  },
  {
    feature: "periods.create_button",
    description: "Create Period button visible",
    verification: {
      type: "button_visible",
      selector: 'button:has-text("Create Period")',
      onPage: "/alliances/{allianceId}/periods",
    },
    expected: { OWNER: true, ADMIN: true, LEADER: false, VIEWER: false },
  },

  // ============================================================
  // Record Metrics (Import Data)
  // ============================================================
  {
    feature: "record.access",
    description: "Can access record metrics page",
    verification: {
      type: "page_accessible",
      path: "/alliances/{allianceId}/periods/{periodId}/record",
    },
    expected: { OWNER: true, ADMIN: true, LEADER: true, VIEWER: false },
  },
  {
    feature: "import.access",
    description: "Can access import metrics page",
    verification: {
      type: "page_accessible",
      path: "/alliances/{allianceId}/periods/{periodId}/import",
    },
    expected: { OWNER: true, ADMIN: true, LEADER: true, VIEWER: false },
  },

  // ============================================================
  // Leadership Notes
  // ============================================================
  {
    feature: "notes.view",
    description: "Can view leadership notes on member page",
    verification: {
      type: "page_accessible",
      path: "/alliances/{allianceId}/members/{memberId}",
    },
    expected: { OWNER: true, ADMIN: true, LEADER: true, VIEWER: true },
  },
  {
    feature: "notes.add_form",
    description: "Add Note form visible on member page",
    verification: {
      type: "form_functional",
      selector: 'form:has(textarea[name="content"])',
      onPage: "/alliances/{allianceId}/members/{memberId}",
    },
    expected: { OWNER: true, ADMIN: true, LEADER: true, VIEWER: false },
  },

  // ============================================================
  // Invitations
  // ============================================================
  {
    feature: "invitations.access",
    description: "Can access invitations page",
    verification: {
      type: "page_accessible",
      path: "/alliances/{allianceId}/settings/invitations",
    },
    expected: { OWNER: true, ADMIN: true, LEADER: false, VIEWER: false },
  },
  {
    feature: "invitations.send_form",
    description: "Send Invitation form functional",
    verification: {
      type: "form_functional",
      selector: 'form:has(input[name="email"])',
      onPage: "/alliances/{allianceId}/settings/invitations",
    },
    expected: { OWNER: true, ADMIN: true, LEADER: false, VIEWER: false },
  },

  // ============================================================
  // Setup
  // ============================================================
  {
    feature: "setup.access",
    description: "Can access setup page",
    verification: {
      type: "page_accessible",
      path: "/alliances/{allianceId}/setup",
    },
    expected: { OWNER: true, ADMIN: true, LEADER: true, VIEWER: true },
  },

  // ============================================================
  // Platform (separate from alliance roles)
  // ============================================================
  {
    feature: "platform.dashboard",
    description: "Can access platform dashboard",
    verification: {
      type: "page_accessible",
      path: "/platform",
    },
    expected: { OWNER: false, ADMIN: false, LEADER: false, VIEWER: false },
  },
];

/**
 * Filter matrix to get permissions for a specific role.
 */
export function getPermissionsForRole(role: Role): FeaturePermission[] {
  return PERMISSION_MATRIX.filter((p) => p.expected[role]);
}

/**
 * Filter matrix to get denied features for a specific role.
 */
export function getDeniedFeaturesForRole(role: Role): FeaturePermission[] {
  return PERMISSION_MATRIX.filter((p) => !p.expected[role]);
}

/**
 * Get all page accessibility checks.
 */
export function getPageAccessChecks(): FeaturePermission[] {
  return PERMISSION_MATRIX.filter(
    (p) => p.verification.type === "page_accessible"
  );
}

/**
 * Get all UI visibility checks (links, buttons, forms).
 */
export function getUIVisibilityChecks(): FeaturePermission[] {
  return PERMISSION_MATRIX.filter(
    (p) => p.verification.type !== "page_accessible"
  );
}

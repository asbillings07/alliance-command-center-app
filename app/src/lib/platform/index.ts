/**
 * Platform Domain Services
 *
 * Services model stable platform concepts.
 * Pages compose those services into workflows.
 *
 * @example
 * import { getAllianceHealth, getActionRequiredBySeverity } from "@/app/src/lib/platform";
 */

// Alliance domain
export {
  getAllianceHealth,
  getAllianceReadiness,
  getAllianceSetupStatusById,
  getAllianceReadinessSummary,
  getAllAlliances,
  getAllianceTimeline,
  getAllianceById,
  type AllianceHealth,
  type AllianceReadinessItem,
  type AllianceReadinessSummary,
  type AllianceReadinessStatus,
  type AlliancePlatformSetupStatus,
  type AllianceFilters,
  type AllianceTimeline,
  type TimelineEvent,
} from "./alliances";

// Invitations domain
export {
  getBetaInvitations,
  getCollaboratorInvitations,
  getInvitationStats,
  getAcceptedWithoutAlliance,
  type BetaInvitationItem,
  type BetaInvitationStatus,
  type CollaboratorInvitationItem,
  type InvitationStats,
} from "./invitations";

// Activity domain
export {
  getRecentActivity,
  getAllianceActivity,
  type ActivityItem,
  type ActivityType,
  type ActivityFilters,
} from "./activity";

// Setup domain
export {
  getSetupFunnel,
  getStalledAlliances,
  getNewAlliances,
  type FunnelStage,
  type SetupFunnel,
} from "./setup";

// Attention domain
export {
  getActionRequired,
  getActionRequiredBySeverity,
  getActionRequiredCounts,
  type ActionRequiredItem,
  type GroupedActionRequired,
  type Severity,
} from "./attention";

// Search domain
export {
  searchAlliances,
  searchUsers,
  searchMembers,
  searchInvitations,
  searchPlatform,
  type SearchResult,
  type SearchResults,
  type SearchResultType,
} from "./search";

// Bootstrap domain
export {
  isPlatformInitialized,
  getBootstrapAllowedEmails,
  canInitializePlatform,
  verifyBootstrapSecret,
} from "./bootstrap";

// Admin workspace navigation
export {
  getAdminAllianceWorkspaceDestination,
  type AdminAllianceWorkspace,
} from "./adminWorkspace";

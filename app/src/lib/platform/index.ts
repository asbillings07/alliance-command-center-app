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
  getAllianceReadinessSummary,
  getAllAlliances,
  getAllianceTimeline,
  getAllianceById,
  getJumpLinks,
  type AllianceHealth,
  type AllianceReadinessItem,
  type AllianceReadinessSummary,
  type AllianceReadinessStatus,
  type AllianceFilters,
  type AllianceTimeline,
  type TimelineEvent,
  type JumpLink,
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

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

// Invitations domain (legacy invitation-centric queries)
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

// Beta participant operations (#174)
export {
  listBetaParticipants,
  listBetaParticipantPriorAttempts,
  listBetaParticipantsNeedingAttention,
  queryBetaParticipantDerivationForTest,
  betaParticipantsDerivationCte,
  BETA_PARTICIPANTS_CTE_VERSION,
  BETA_PARTICIPANTS_ATTENTION_LIST_LIMIT,
  clampBetaParticipantsPagination,
  boundBetaParticipantsInput,
  escapeIlikePattern,
  buildIlikeContainsPattern,
  deriveJourneyStage,
  deriveParticipantAttention,
  deriveLatestAttemptStatus,
  type BetaParticipantFilters,
  type BetaParticipantListItem,
  type BetaParticipantAttentionRow,
  type BetaParticipantListResult,
  type BetaParticipantSummary,
  type BetaParticipantPriorAttempt,
  type BetaJourneyStage,
  type BetaAttentionReason,
  type BetaInvitationAttemptStatus,
} from "./betaParticipants";

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
  mapBetaParticipantToActionRequired,
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

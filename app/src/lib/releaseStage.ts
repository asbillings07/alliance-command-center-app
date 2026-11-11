/** Public product status. Change deliberately when the owner approves a new stage.
 * This label never controls invitations, authentication, or feature access.
 */
export const releaseStage: "private-beta" | "public-beta" = "private-beta";

export const releaseStageLabels = {
  "private-beta": "Private beta",
  "public-beta": "Public beta",
} as const;

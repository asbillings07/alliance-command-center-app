export const reviewStages = {
  recognition_finished: "Recognition review finished",
  score_displayed: "Score review displayed",
  confirmation_dismissed: "Confirmation dismissed",
} as const;

export type ReviewStage = keyof typeof reviewStages;

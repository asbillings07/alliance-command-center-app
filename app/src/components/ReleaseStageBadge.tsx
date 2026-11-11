import { releaseStage, releaseStageLabels } from "@/app/src/lib/releaseStage";

export function ReleaseStageBadge() {
  return (
    <span data-testid="release-stage-badge" className="brand-header-badge whitespace-nowrap rounded-full border border-border font-medium text-text-secondary">
      {releaseStageLabels[releaseStage]}
    </span>
  );
}

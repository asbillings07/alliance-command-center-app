import { releaseStage, releaseStageLabels } from "@/app/src/lib/releaseStage";

/** Shared at the document level so standalone and error pages keep the label. */
export function ReleaseStageBanner() {
  return (
    <section aria-label="Release stage" className="flex shrink-0 justify-center border-b border-border bg-brand-surface px-4 py-2">
      <span className="whitespace-nowrap rounded-full border border-border px-3 py-1.5 text-xs font-medium text-text-secondary">
        {releaseStageLabels[releaseStage]}
      </span>
    </section>
  );
}

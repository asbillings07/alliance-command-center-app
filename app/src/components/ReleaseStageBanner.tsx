import { releaseStage, releaseStageLabels } from "@/app/src/lib/releaseStage";

/** Shared at the document level so standalone and error pages keep the label. */
export function ReleaseStageBanner() {
  return (
    <section aria-label="Release stage" className="sticky top-0 z-20 flex h-12 shrink-0 items-center justify-center border-b border-border bg-brand-surface px-4">
      <span className="whitespace-nowrap rounded-full border border-border px-3 py-1.5 text-xs font-medium text-text-secondary">
        {releaseStageLabels[releaseStage]}
      </span>
    </section>
  );
}

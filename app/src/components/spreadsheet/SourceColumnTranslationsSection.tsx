"use client";

import type { ColumnTranslation } from "@/app/src/lib/importTranslation";
import {
  columnTranslationRequiresAction,
  shouldSourceColumnTranslationsDefaultOpen,
} from "@/app/src/lib/import/importPreviewHelpers";

type SourceColumnTranslationsSectionProps = {
  translations: ColumnTranslation[];
  children?: React.ReactNode;
};

export function SourceColumnTranslationsSection({
  translations,
  children,
}: SourceColumnTranslationsSectionProps) {
  const defaultOpen = shouldSourceColumnTranslationsDefaultOpen(translations);
  const pendingActionCount = translations.filter(columnTranslationRequiresAction).length;

  return (
    <details
      open={defaultOpen}
      className="bg-surface border border-border rounded-xl overflow-hidden group"
      data-testid="source-column-translations"
    >
      <summary className="cursor-pointer list-none px-4 py-3 flex items-center justify-between gap-3 select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface [&::-webkit-details-marker]:hidden">
        <div className="flex items-center gap-2 min-w-0">
          <span
            aria-hidden="true"
            className="text-text-muted transition-transform group-open:rotate-90 shrink-0"
          >
            ▸
          </span>
          <h3 className="font-semibold text-text-primary text-sm">Source Column Translations</h3>
        </div>
        {pendingActionCount > 0 ? (
          <span className="shrink-0 px-2 py-0.5 rounded-full text-[11px] font-medium bg-warning/15 text-warning border border-warning/30">
            {pendingActionCount} column{pendingActionCount === 1 ? "" : "s"} need action
          </span>
        ) : (
          <span className="shrink-0 px-2 py-0.5 rounded-full text-[11px] font-medium bg-success/10 text-success border border-success/30">
            All columns mapped
          </span>
        )}
      </summary>
      <div className="px-4 pb-4 space-y-2 border-t border-border/60">{children}</div>
    </details>
  );
}

import { ReactNode } from "react";

type Props = {
  titleId: string;
  title: string;
  summaryId: string;
  /** Visible text — the chart's accessible substitute, not merely a caption. */
  summary: string;
  /** e.g. "Chart data — 10 rows". Caller-built rather than a single `rowCount` number, since some charts (TRUE_RATE) disclose two separate tables. */
  dataDisclosureLabel: string;
  /** The CSS/SVG graphic. Wrapped in `aria-hidden="true"` below — never the accessible representation on its own. */
  visual: ReactNode;
  /** The equivalent semantic `<table>`(s). */
  table: ReactNode;
  testId?: string;
};

/**
 * The consistent accessible structure every metric drill-down chart uses
 * (#264 PR5): a visible one-sentence summary, a purely decorative
 * `aria-hidden` graphic, and a `<details open>`-disclosed data table that
 * *is* the chart's accessible representation. Screen readers never need to
 * parse SVG/CSS bar geometry — the summary text and table carry the same
 * information a sighted user reads from the graphic.
 *
 * `open` by default per the product decision to ship the disclosure
 * expanded during beta, so sighted users can audit a chart against its
 * backing numbers without an extra click.
 */
export function ChartSection({ titleId, title, summaryId, summary, dataDisclosureLabel, visual, table, testId }: Props) {
  return (
    <section aria-labelledby={titleId} data-testid={testId}>
      <h2 id={titleId} className="text-lg font-semibold text-text-primary mb-2">
        {title}
      </h2>
      <p id={summaryId} className="text-sm text-text-secondary mb-4">
        {summary}
      </p>
      <div aria-hidden="true">{visual}</div>
      <details open className="mt-4">
        <summary className="cursor-pointer text-sm text-text-muted hover:text-text-secondary select-none">
          {dataDisclosureLabel}
        </summary>
        <div className="mt-3 overflow-x-auto">{table}</div>
      </details>
    </section>
  );
}

import type { ReactNode } from "react";

type Column = { label: string; align?: "left" | "center" | "right" };
const alignment = { left: "text-left", center: "text-center", right: "text-right" };

export function ImportReviewTable({ columns, label, stackOnPhone, children }: {
  columns: Column[];
  label: string;
  stackOnPhone?: boolean;
  children: ReactNode;
}) {
  return <table aria-label={label} className={`w-full text-sm ${stackOnPhone ? "max-sm:block sm:table-fixed" : ""}`}>
    <thead className={`border-b border-border bg-surface-secondary ${stackOnPhone ? "max-sm:sr-only" : ""}`}>
      <tr className="font-semibold text-text-primary">{columns.map(col =>
        <th key={col.label} scope="col" className={`px-3 py-2 ${alignment[col.align ?? "left"]}`}>{col.label}</th>
      )}</tr>
    </thead>
    <tbody className={stackOnPhone ? "max-sm:block" : undefined}>{children}</tbody>
  </table>;
}

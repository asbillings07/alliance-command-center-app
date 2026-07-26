"use client";

import { useState } from "react";

type SpreadsheetDataShapeGuideProps = {
  type: "metrics" | "roster";
  periodName?: string;
};

const METRIC_CSV_EXAMPLE = `Player Name,VS Kills,Hero Power,Drone Level
Commander Alpha,1250,1520000,85
Commander Bravo,980,1410000,80
Commander Charlie,2100,1850000,90`;

const ROSTER_CSV_EXAMPLE = `Player Name,Total Hero Power,Role,Notes
Commander Alpha,1520000,R4,Main Alliance Tank
Commander Bravo,1410000,R3,
Commander Charlie,1850000,R4,Rally Leader`;

export function SpreadsheetDataShapeGuide({ type, periodName }: SpreadsheetDataShapeGuideProps) {
  const [copied, setCopied] = useState(false);
  const [isOpen, setIsOpen] = useState(true);

  const exampleCsv = type === "metrics" ? METRIC_CSV_EXAMPLE : ROSTER_CSV_EXAMPLE;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(exampleCsv);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  };

  const handleDownload = () => {
    const blob = new Blob([exampleCsv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute(
      "download",
      type === "metrics" ? "acc_metric_import_template.csv" : "acc_member_import_template.csv"
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="bg-surface border border-border rounded-xl p-4 text-xs space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <span className="text-amber-500 font-bold text-sm">📋</span>
          <h4 className="font-semibold text-text-primary text-sm">
            {type === "metrics"
              ? `Expected Metric Spreadsheet Format ${periodName ? `(${periodName})` : ""}`
              : "Expected Alliance Member Format"}
          </h4>
        </div>
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="text-xs text-text-muted hover:text-text-primary font-medium underline"
        >
          {isOpen ? "Hide Format Guide" : "Show Format Guide"}
        </button>
      </div>

      {isOpen && (
        <div className="space-y-3 text-text-muted pt-1">
          <p className="leading-relaxed">
            {type === "metrics" ? (
              <>
                Alliance Command Center expects a tabular sheet with a column for player names (auto-detected from headers like <strong>Player</strong>, <strong>Member</strong>, <strong>Name</strong>, or <strong>IGN</strong>) and numeric metric result columns for the selected destination period.
              </>
            ) : (
              <>
                Import or restore members into your alliance. Spreadsheet requires a player name column (auto-detected from headers like <strong>Player</strong>, <strong>Member</strong>, <strong>Name</strong>, or <strong>IGN</strong>). Optional columns include <strong>Total Hero Power (THP)</strong> and <strong>Role / Game Rank</strong>. New members are created, archived members can be restored, and existing active members remain unchanged.
              </>
            )}
          </p>

          <div className="bg-surface-secondary/40 p-3 rounded-lg border border-border/50 space-y-2">
            <div className="flex items-center justify-between text-[11px] font-mono font-medium text-text-primary">
              <span>Sample Spreadsheet Table</span>
              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={handleCopy}
                  className="px-2 py-1 bg-surface-secondary text-text-primary hover:bg-surface-secondary/80 rounded transition-colors"
                >
                  {copied ? "Copied CSV!" : "Copy Sample CSV"}
                </button>
                <button
                  type="button"
                  onClick={handleDownload}
                  className="px-2 py-1 bg-primary text-white hover:bg-primary-hover rounded transition-colors"
                >
                  Download .csv Template
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-left font-mono text-[11px] divide-y divide-border/60">
                <thead>
                  <tr className="text-text-primary bg-surface-secondary/60">
                    {type === "metrics" ? (
                      <>
                        <th className="px-2 py-1 border-r border-border/40">Player Name</th>
                        <th className="px-2 py-1 border-r border-border/40">VS Kills</th>
                        <th className="px-2 py-1 border-r border-border/40">Hero Power</th>
                        <th className="px-2 py-1">Drone Level</th>
                      </>
                    ) : (
                      <>
                        <th className="px-2 py-1 border-r border-border/40">Player Name</th>
                        <th className="px-2 py-1 border-r border-border/40">Total Hero Power</th>
                        <th className="px-2 py-1 border-r border-border/40">Role</th>
                        <th className="px-2 py-1">Notes</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30 text-text-muted">
                  {type === "metrics" ? (
                    <>
                      <tr>
                        <td className="px-2 py-1 border-r border-border/30 text-text-primary font-medium">Commander Alpha</td>
                        <td className="px-2 py-1 border-r border-border/30">1,250</td>
                        <td className="px-2 py-1 border-r border-border/30">1,520,000</td>
                        <td className="px-2 py-1">85</td>
                      </tr>
                      <tr>
                        <td className="px-2 py-1 border-r border-border/30 text-text-primary font-medium">Commander Bravo</td>
                        <td className="px-2 py-1 border-r border-border/30">980</td>
                        <td className="px-2 py-1 border-r border-border/30">1,410,000</td>
                        <td className="px-2 py-1">80</td>
                      </tr>
                    </>
                  ) : (
                    <>
                      <tr>
                        <td className="px-2 py-1 border-r border-border/30 text-text-primary font-medium">Commander Alpha</td>
                        <td className="px-2 py-1 border-r border-border/30">1,520,000</td>
                        <td className="px-2 py-1 border-r border-border/30">R4</td>
                        <td className="px-2 py-1">Main Alliance Tank</td>
                      </tr>
                      <tr>
                        <td className="px-2 py-1 border-r border-border/30 text-text-primary font-medium">Commander Bravo</td>
                        <td className="px-2 py-1 border-r border-border/30">1,410,000</td>
                        <td className="px-2 py-1 border-r border-border/30">R3</td>
                        <td className="px-2 py-1">—</td>
                      </tr>
                    </>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

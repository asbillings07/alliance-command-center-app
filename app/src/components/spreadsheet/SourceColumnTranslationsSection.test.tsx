/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SourceColumnTranslationsSection } from "./SourceColumnTranslationsSection";
import { ColumnTranslationCard } from "./ColumnTranslationCard";
import type { ColumnTranslation } from "@/app/src/lib/importTranslation";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

describe("SourceColumnTranslationsSection [component]", () => {
  it("defaults closed when every mapping is resolved and open when action is required", async () => {
    const resolved: ColumnTranslation[] = [
      {
        kind: "identity",
        sourceColumnName: "Player",
        columnIndex: 0,
        samples: ["Dragon"],
        targetLabel: "Member Identity",
        status: "mapped",
      },
      {
        kind: "metric",
        sourceColumnName: "Kill Points",
        columnIndex: 1,
        samples: ["100"],
        target: { kind: "existing", metricId: "met1" },
        classification: {
          columnIndex: 1,
          columnName: "Kill Points",
          intent: "likely_metric",
          reason: "matches_existing_metric",
          confidence: "high",
          needsConfirmation: false,
        },
        confirmationStatus: "confirmed_metric",
        status: "mapped",
      },
    ];

    await act(async () => {
      root.render(
        createElement(
          SourceColumnTranslationsSection,
          { translations: resolved },
          ...resolved.map((translation) =>
            createElement(ColumnTranslationCard, { key: translation.columnIndex, translation }),
          ),
        ),
      );
    });

    const resolvedDetails = container.querySelector('[data-testid="source-column-translations"]') as HTMLDetailsElement;
    expect(resolvedDetails.open).toBe(false);
    expect(resolvedDetails.textContent).toContain("All columns mapped");

    const unresolved: ColumnTranslation[] = [
      ...resolved,
      {
        kind: "metric",
        sourceColumnName: "Mystery",
        columnIndex: 2,
        samples: ["50"],
        target: { kind: "create", name: "" },
        classification: {
          columnIndex: 2,
          columnName: "Mystery",
          intent: "unsure",
          reason: "ambiguous_name",
          confidence: "low",
          needsConfirmation: true,
        },
        confirmationStatus: "unconfirmed",
        status: "unconfirmed",
      },
    ];

    await act(async () => {
      root.render(
        createElement(
          SourceColumnTranslationsSection,
          { translations: unresolved },
          ...unresolved.map((translation) =>
            createElement(ColumnTranslationCard, { key: translation.columnIndex, translation }),
          ),
        ),
      );
    });

    const unresolvedDetails = container.querySelector('[data-testid="source-column-translations"]') as HTMLDetailsElement;
    expect(unresolvedDetails.open).toBe(true);
    expect(unresolvedDetails.textContent).toContain("1 column need action");
    expect(unresolvedDetails.textContent).toContain("Ambiguous Column Header");
  });
});

import type { MetricInfo, MetricCoverage } from "@/app/src/lib/reports/getMetricSummaryReport";
import type { MetricVisualModel } from "@/app/src/lib/reports/metricVisualModel";
import { SumContributionChart } from "./SumContributionChart";
import { AverageDistributionChart, NoneNumericDistributionChart } from "./DistributionHistogram";
import { TrueRateBreakdownChart, NoneBooleanBreakdownChart } from "./CategoricalBreakdownBars";

type Props = {
  metric: MetricInfo;
  visualModel: MetricVisualModel;
  coverage: MetricCoverage;
};

/**
 * Dispatches to the one summary-kind-appropriate chart (#264 PR5). Each
 * chart owns its own card shell and its own `null` return when there's
 * genuinely nothing to draw (e.g. zero contributors) — that decision can
 * only be made once the model's actual values are inspected, which this
 * dispatcher deliberately doesn't duplicate.
 */
export function MetricVisualSection({ metric, visualModel, coverage }: Props) {
  switch (visualModel.kind) {
    case "SUM":
      return <SumContributionChart visualModel={visualModel} unitLabel={metric.unitLabel} />;
    case "AVERAGE":
      return <AverageDistributionChart visualModel={visualModel} unitLabel={metric.unitLabel} />;
    case "TRUE_RATE":
      return <TrueRateBreakdownChart visualModel={visualModel} coverage={coverage} />;
    case "NONE":
      return visualModel.valueKind === "NUMERIC" ? (
        <NoneNumericDistributionChart visualModel={visualModel} unitLabel={metric.unitLabel} />
      ) : (
        <NoneBooleanBreakdownChart visualModel={visualModel} coverage={coverage} />
      );
  }
}

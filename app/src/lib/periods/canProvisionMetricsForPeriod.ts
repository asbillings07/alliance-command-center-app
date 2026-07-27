type CanProvisionMetricsParams = {
  canConfigureMetrics: boolean;
  canConfigurePeriods: boolean;
  attachableLibraryMetricCount: number;
};

/**
 * Whether import can provision metrics for a period that has none assigned yet.
 * Matches the rule on the period import page.
 */
export function canProvisionMetricsForPeriod({
  canConfigureMetrics,
  canConfigurePeriods,
  attachableLibraryMetricCount,
}: CanProvisionMetricsParams): boolean {
  return (
    canConfigureMetrics ||
    (canConfigurePeriods && attachableLibraryMetricCount > 0)
  );
}

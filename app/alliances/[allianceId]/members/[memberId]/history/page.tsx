import Link from "next/link";
import { notFound } from "next/navigation";
import { PageLayout, Card, Badge } from "@/app/src/components";
import { Button } from "@/app/src/components/client";
import { loadMemberMetricHistory, type MetricHistoryEntry } from "@/app/src/lib/metrics/memberMetricHistory";

const methods = {
  MANUAL: "Manual entry",
  SPREADSHEET_SINGLE_PERIOD: "Spreadsheet import",
  SPREADSHEET_MULTI_PERIOD: "Multi-period spreadsheet import",
};
const roles = { OWNER: "Owner", ADMIN: "Admin", LEADER: "Leader", VIEWER: "Viewer" };
const number = new Intl.NumberFormat("en-US");
const timestamp = new Intl.DateTimeFormat("en-US", {
  month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  second: "2-digit", timeZone: "UTC", timeZoneName: "short",
});
function value(entry: MetricHistoryEntry) {
  return entry.status === "VOIDED" ? "Value voided" : number.format(entry.value!);
}
function queryValue(value: string | string[] | undefined) {
  if (Array.isArray(value) || (value && value.length > 200)) notFound();
  return value || undefined;
}

export default async function MemberMetricHistoryPage({ params, searchParams }: {
  params: Promise<{ allianceId: string; memberId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { allianceId, memberId } = await params;
  const query = await searchParams;
  const metricId = queryValue(query.metricId);
  const before = queryValue(query.before);
  const entryId = queryValue(query.entryId);
  const { member, metrics, entries, selected, nextBefore } = await loadMemberMetricHistory({
    allianceId, memberId, metricId, before, entryId,
  });
  const memberHref = `/alliances/${allianceId}/members/${memberId}`;
  const historyHref = `${memberHref}/history`;
  function href(options: { entryId?: string; before?: string } = {}) {
    const q = new URLSearchParams({ ...(metricId ? { metricId } : {}), ...options });
    return `${historyHref}${q.size ? `?${q}` : ""}`;
  }
  const listHref = href(before ? { before } : {});
  return (
    <main>
    <PageLayout maxWidth="6xl" title="Go back in time"
      description={`${member.playerName} · Review saved values and who recorded them.`}
      breadcrumb={[
        { label: "Members", href: `/alliances/${allianceId}/members` },
        { label: member.playerName, href: memberHref }, { label: "Go back in time" },
      ]}
      action={<Button href={memberHref} variant="secondary">Back to member</Button>}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-text-muted">Read-only history · Browsing never changes a result.</p>
          {member.archivedAt && <Badge variant="neutral">Archived member</Badge>}
        </div>
        <form action={historyHref} className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-2 min-w-0 flex-1 sm:flex-none">
            <label htmlFor="history-metric" className="text-sm font-medium text-text-secondary">Metric</label>
            <select id="history-metric" name="metricId" defaultValue={metricId ?? ""}
              className="w-full sm:max-w-80 min-h-11 rounded-lg border border-border bg-surface px-3 py-2 text-text-primary focus:outline-none focus:ring-2 focus:ring-primary">
              <option value="">All metrics</option>
              {metrics.map((metric) => <option key={metric.id} value={metric.id}>{metric.name}</option>)}
            </select>
          </div>
          <Button type="submit" variant="secondary" size="lg">Apply</Button>
        </form>
        {entries.length === 0 && !selected ? (
          <Card><h2 className="font-semibold text-text-primary">No metric history yet</h2>
            <p className="mt-2 text-sm text-text-muted">Saved manual entries and spreadsheet imports will appear here. Earlier values are kept when a new value is recorded.</p>
          </Card>
        ) : (
          <div className="grid gap-6 md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
            <section aria-label="Recorded history" className={`min-w-0 ${entryId ? "hidden md:block" : ""}`}>
              <h2 className="text-lg font-semibold text-text-primary">Recorded history</h2>
              <p className="mt-1 mb-4 text-sm text-text-muted">Newest recorded first · Times in UTC</p>
              <ol className="space-y-3">
                {entries.map((entry) => (
                  <li key={entry.id}>
                    <Link href={href({ ...(before ? { before } : {}), entryId: entry.id })}
                      prefetch={false} aria-current={selected?.id === entry.id ? "true" : undefined}
                      className={`block rounded-xl border p-4 min-w-0 break-words transition-colors focus:outline-none focus:ring-2 focus:ring-primary ${selected?.id === entry.id ? "border-primary bg-primary/10" : "border-border bg-surface hover:bg-surface-secondary"}`}>
                      <span className="block text-xs text-text-muted"><time dateTime={entry.recordedAt.toISOString()}>{timestamp.format(entry.recordedAt)}</time></span>
                      <span className="block mt-2 text-sm text-text-secondary">{entry.metric.name} · {entry.periodMetric.period.name}</span>
                      <span className="block mt-1 text-2xl font-semibold tabular-nums text-text-primary">{value(entry)}
                        {entry.status !== "VOIDED" && entry.metric.unitLabel && <span className="ml-2 text-sm font-normal text-text-secondary">{entry.metric.unitLabel}</span>}
                      </span>
                      <span className="block mt-2 text-sm text-text-secondary">{entry.enteredByName ?? "Uploader not recorded"}{entry.enteredByRole ? ` · ${roles[entry.enteredByRole]}` : ""}</span>
                      <span className="block mt-1 text-xs text-text-muted">{entry.entryMethod ? methods[entry.entryMethod] : "Method not recorded"}</span>
                    </Link>
                  </li>
                ))}
              </ol>
              <nav aria-label="History pages" className="flex flex-wrap gap-3 mt-4">
                {before && <Button variant="secondary" href={href()}>Newest entries</Button>}
                {nextBefore && <Button variant="secondary" href={href({ before: nextBefore })}>Older entries</Button>}
              </nav>
            </section>
            {selected && (
              <section aria-label="Entry details" className={`min-w-0 ${entryId ? "" : "hidden md:block"}`}>
                <div className="mb-4 md:hidden"><Button href={listHref} variant="secondary" size="lg">← All history</Button></div>
                <Card padding="sm">
                  <div className="p-1 sm:p-2 break-words">
                    <Badge variant="neutral">Saved entry</Badge>
                    <h2 className="mt-4 text-lg font-semibold text-text-primary">{selected.metric.name}</h2>
                    <p className="mt-1 text-sm text-text-muted">{selected.periodMetric.period.name}</p>
                    <p className="mt-5 text-sm text-text-secondary">Recorded value</p>
                    <p className="mt-1 text-3xl sm:text-4xl font-semibold tabular-nums text-text-primary">{value(selected)}</p>
                    {selected.status !== "VOIDED" && selected.metric.unitLabel && <p className="mt-1 text-text-muted">{selected.metric.unitLabel}</p>}
                    <p className="mt-4 text-sm text-text-muted">This is the value saved in this entry. Later entries may change the result used in reports.</p>
                    <dl className="mt-5 divide-y divide-border text-sm">
                      {[
                        ["Recorded by", selected.enteredByName ?? "Uploader not recorded"],
                        ["Role when recorded", selected.enteredByRole ? roles[selected.enteredByRole] : "Not recorded"],
                        ["Method", selected.entryMethod ? methods[selected.entryMethod] : "Not recorded"],
                        ["Recorded at", timestamp.format(selected.recordedAt)],
                        ["Observation date", selected.observedOn?.toISOString().slice(0, 10) ?? "Period value · no daily date"],
                      ].map(([label, text]) => <div key={label} className="py-3 grid grid-cols-1 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-1 lg:gap-3">
                        <dt className="text-text-muted">{label}</dt><dd className="font-medium text-text-primary">{text}</dd>
                      </div>)}
                    </dl>
                    {!selected.entryMethod && <p className="mt-4 rounded-lg bg-surface-secondary p-3 text-sm text-text-secondary">This entry predates attribution or came from a source that did not record it. Its uploader and method cannot be reconstructed.</p>}
                    <details className="mt-5 text-sm text-text-muted">
                      <summary className="cursor-pointer rounded py-2 focus:outline-none focus:ring-2 focus:ring-primary">About this record</summary>
                      <p className="mt-2">These entries do not contain screenshot evidence, capture time, or in-progress/final status. A saved value is not proof of a completed game day. Metric and period labels reflect their current names.</p>
                      <p className="mt-3 break-all">Entry reference: {selected.id}</p>
                    </details>
                  </div>
                </Card>
              </section>
            )}
          </div>
        )}
      </div>
    </PageLayout>
    </main>
  );
}

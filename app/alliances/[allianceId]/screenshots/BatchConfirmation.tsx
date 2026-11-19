"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ConfirmDialog } from "@/app/src/components/client";
import type { BatchSelection } from "@/app/src/lib/ocr/confirmedBatch";
import { checkBatch } from "./batchAction";

export type BatchDestination = { periodId: string; name: string; metrics: { id: string; name: string; daily: boolean }[] };
type Review = NonNullable<Awaited<ReturnType<typeof checkBatch>>["review"]>;
export function BatchConfirmation({ destination, daily, weekly, selection }: {
  destination: BatchDestination; daily: boolean; weekly: boolean; selection: Omit<BatchSelection, "dailyMetric" | "weeklyMetric">;
}) {
  const [dailyMetric, setDaily] = useState(""), [weeklyMetric, setWeekly] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false), [lower, setLower] = useState(false), [error, setError] = useState("");
  const [createConfirmed, setCreateConfirmed] = useState(false);
  const newNames = [...new Set(review?.comparisons.filter(r => r.createMember).map(r => r.member) ?? [])];
  const router = useRouter();
  const input = { ...selection, dailyMetric, weeklyMetric };
  const decreases = review?.comparisons.some(row => row.previous !== null && row.value < row.previous);
  const open = async () => {
    setBusy(true); setError(""); setLower(false); setCreateConfirmed(false);
    try {
      const result = await checkBatch(input);
      if (!result.review) setError(result.error); else setReview(result.review);
    } catch { setError("Review unavailable. Your selection is still here."); }
    finally { setBusy(false); }
  };
  return <section className="mt-4 space-y-3 border-t border-border pt-4">
    <h3 className="font-semibold">Save scores to {destination.name}</h3>
    {review?.saved ? <div role="status"><strong>{review.comparisons.length} scores saved</strong> · {review.excluded} excluded
      <ul>{review.comparisons.map(r => <li key={r.memberId + r.window}><Link className="text-primary underline" href={`/alliances/${selection.allianceId}/members/${r.memberId}/history?metricId=${r.metricId}`}>{r.member}</Link> · {r.value.toLocaleString()} · {r.window.replace("week:", "Week of ")}</li>)}</ul></div> : <>
      {[true,false].filter(isDaily => isDaily ? daily : weekly).map(isDaily => <label key={String(isDaily)} className="block"> {isDaily ? "Daily score metric" : "Weekly total metric"}
        <select className="block w-full rounded border border-border bg-surface p-2" value={isDaily ? dailyMetric : weeklyMetric}
          onChange={e => (isDaily ? setDaily : setWeekly)(e.target.value)} disabled={busy}>
          <option value="">Choose a metric</option>
          {destination.metrics.filter(m => m.daily === isDaily).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select></label>)}
      <Button disabled={busy || (daily && !dailyMetric) || (weekly && !weeklyMetric)} onClick={open}>Review score changes</Button>
    </>}
    {error && <p role="alert">{error}</p>}
    {review && !review.saved && <ConfirmDialog isOpen title="Apply these scores?" confirmLabel="Confirm and save scores"
      confirmDisabled={(!!decreases && !lower) || (newNames.length > 0 && !createConfirmed)} onClose={() => setReview(current => current?.saved ? current : null)}
      description={<div className="space-y-3"><p>Check each member and reporting date. These scores will appear in leadership results and member history. {review.excluded} rows excluded.</p>
        <ul className="max-h-52 overflow-auto space-y-2">{review.comparisons.map(r => <li key={r.memberId+r.window}><strong>{r.member}</strong> · {r.metric} · {r.window.replace("week:", "Week of ")}<br/>{r.previous?.toLocaleString() ?? "No prior score"} → {r.value.toLocaleString()}</li>)}</ul>
        {newNames.length > 0 && <div className="rounded-lg border border-warning p-3">
          <strong>{newNames.length} new roster {newNames.length === 1 ? "member" : "members"} will be created</strong>
          <p className="my-2 break-words">{newNames.join(", ")}</p>
          <label><input type="checkbox" checked={createConfirmed} onChange={e => setCreateConfirmed(e.target.checked)} /> Create these roster members and save their scores.</label>
        </div>}
        {decreases && <label className="block"><input type="checkbox" checked={lower} onChange={e => setLower(e.target.checked)} /> I confirm the lower scores shown above. Previous values stay in history.</label>}</div>}
      onConfirm={async () => {
        const result = await checkBatch(input, { comparison: review.comparison, lowerConfirmed: lower, createMembersConfirmed: createConfirmed });
        if (!result.review?.saved) return { error: result.error ?? "Could not confirm the save. Review the batch again." };
        setReview(result.review); router.refresh();
      }} />}
  </section>;
}

# Changelog

A running log of **user-facing** changes, written for the people using the
app (and for beta communications) - not a substitute for
[the ADRs](./adr) (which record *why* a decision was made) or the GitHub
issue history (which records *how* it was built). This file only answers
"what changed, and what does it mean for a leader looking at the app."

Newest entries first. Only add an entry for a change a leader would
actually notice - see `AGENTS.md`'s "if a proposed feature does not improve
leadership decision-making, challenge whether it belongs" for the same bar
applied here: a purely internal refactor with no visible behavior change
does not get an entry.

---

## 2026-08-11 - Period-over-period trend on member metric cards

Member detail metric cards now show **two distinct comparisons** where
before there was only one. If you lead an alliance, here's what's new and
what stayed the same:

- **`+N since last entry`** (unchanged) - a *same-period correction*. If a
  leader re-records or imports a corrected value for a metric within the
  same evaluation period, this shows how much that correction changed the
  number. Nothing about this changed.
- **`▲ / ▼ / – N vs. last period`** (new) - a *period-over-period trend*.
  This compares the metric's value in the period you're viewing against
  its value in the immediately preceding evaluation period. The badge is
  colored **green** when the change is good news for that specific metric
  and **red** when it's bad news - based on how that metric is configured
  ("higher is better" vs. "lower is better"), never a naive "up is always
  good." A rising infraction count, for example, shows red, not green.

Two "nothing to compare yet" states, deliberately left simple rather than
explaining every possible reason:

- **`New`** - this is the very first evaluation period in the alliance's
  history; there is no prior period to compare against at all.
- **`N/A vs. last period`** - a prior period exists, but this metric has no
  comparable value there (not tracked yet that period, the member wasn't
  active yet, or the prior value was voided).

Hovering either badge (or the correction line) shows a one-sentence tooltip
naming which comparison it is, so the two are never confused at a glance.

**Why this shipped:** a leader asked what "current vs. previous" meant on
this page (#319), which surfaced that the page only ever showed a
same-period correction - there was no way to see whether a member was
actually trending up or down period over period. #321-#324 designed and
shipped that missing comparison as a clearly-labeled second signal,
additive to the existing correction behavior, which is otherwise unchanged.

**Post-release verification** (checked 2026-08-11, ~20:30 UTC): the trend UI
shipped to production in #327 (merged 17:55 UTC) - `main` deploys on every
merge (ADR-011) - roughly two hours *before* this checklist was drafted, so
it was never a pre-release gate a reviewer could act on; it's recorded here
as evidence the shipped behavior was actually re-verified, not merely
planned. Confirmed production (`alliancehqapp.com/api/health`) is running
`0679893` at verification time, which includes #327 and #328. No production
login was available in this session, so each scenario below was verified by
re-running the exact automated test against the code confirmed live above,
immediately before recording the result - not by a fresh manual
click-through:

- [x] Member with two entries in the *same* period (a correction) - both
      "since last entry" and "vs. last period" show, with visibly
      different numbers and copy.
      `MemberPerformanceSection.test.tsx` > "renders both the correction
      delta and the period trend badge together on the same card, with
      distinguishable copy" - pass.
- [x] Metric trending up on a "higher is better" metric - green badge.
      `MemberPerformanceSection.test.tsx` > "renders a comparable favorable
      trend in the success color..." - pass.
- [x] Metric trending up on a "lower is better" metric (e.g. an infraction
      count) - red badge, *not* green.
      `MemberPerformanceSection.test.tsx` > "renders a comparable adverse
      trend in the danger color, e.g. a LOWER_IS_BETTER metric trending
      up" - pass. Also verified end to end (real `Metric.trendDirection` ->
      computed favorability) in `page.test.ts` > "classifies an increase on
      a LOWER_IS_BETTER metric as adverse, not favorable..." - pass.
- [x] Metric with no prior period at all (first period in the alliance) -
      "New" badge, not "N/A".
      `MemberPerformanceSection.test.tsx` > "renders 'New' when there is no
      prior period at all - distinct from 'N/A'" - pass.
- [x] Metric present this period but absent/voided in the prior period -
      "N/A vs. last period" badge.
      `MemberPerformanceSection.test.tsx` > "renders 'N/A vs. last period'
      when a prior period exists but this metric has no comparable
      baseline" - pass.

A genuine manual click-through in production against a real alliance is
still worth doing opportunistically (e.g. the next time someone with
leadership access is in the app) - if that surfaces anything the automated
suite missed, record it as a **new** entry below, not an edit to this one
(see this file's append-only note above).

Issues: #319, #320, #321, #322, #323, #324, #325.

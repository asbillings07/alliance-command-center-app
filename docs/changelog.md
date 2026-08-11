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

**Post-release verification** (checked 2026-08-11, ~21:10 UTC): the trend UI
shipped to production in #327 (merged 17:55 UTC) - `main` deploys on every
merge (ADR-011) - roughly two hours *before* this checklist was drafted, so
it was never a pre-release gate a reviewer could act on; it's recorded here
as evidence the shipped behavior was actually re-verified, not merely
planned.

A real click-through against production confirmed the core rendering with
live data - a member's Season 4 card simultaneously showed four independent
`comparable` trend badges with real deltas (e.g. `▲ +35.6M vs. last period`,
`▼ -58.3M vs. last period`) and two `N/A vs. last period` badges for metrics
absent from the prior period, all on one page, each metric resolving
independently and correctly:

- [x] Comparable trend renders correctly with real numbers/arrows and
      distinct copy from the correction line - **verified via live
      production click-through** (member card, Season 4, four metrics with
      real up/down deltas).
- [x] `N/A vs. last period` renders correctly with real data - **verified
      via live production click-through** (same card, two metrics absent
      from the prior period).
- [ ] Favorability coloring (green in a hopeful/favorable sense = matches
      the metric's own "higher/lower is better" config, red = adverse) -
      **not observable in production today**: every real alliance's
      metrics are currently configured `NEUTRAL` (confirmed via a read-only
      production query before this click-through), so every live badge
      renders in the neutral color regardless of direction. Verified only
      via `MemberPerformanceSection.test.tsx`'s favorable/adverse cases and
      `page.test.ts`'s LOWER_IS_BETTER end-to-end case - pass. Re-verify
      live once any alliance configures a non-`NEUTRAL` metric with real
      entries.
- [ ] `New` (first-ever period) - not observable in this click-through
      (Season 4 isn't BVRN's first period). Verified only via
      `MemberPerformanceSection.test.tsx`'s "renders 'New'..." case - pass.
- [ ] Same-period correction (`since last entry`) and the trend badge on
      one card together - not observable today: no alliance in production
      currently has more than one entry for the same member/metric/period
      (confirmed via the same read-only query). Verified only via
      `MemberPerformanceSection.test.tsx`'s mixed-rendering case and
      `page.test.ts`'s multiple-entries wiring case - pass.

The three unchecked items above are not a gap in this PR's testing -
they're scenarios real production data simply can't exercise yet, not
scenarios where the shipped code was observed to be wrong. Whoever notices
production first grow a non-`NEUTRAL` metric with real entries, a
same-period correction, or a view of an alliance's first-ever period should
come back and check the corresponding box(es) above directly, rather than
opening a new entry for it - this checklist is tracking progress toward
its own completion, not a separate release.

Issues: #319, #320, #321, #322, #323, #324, #325.

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

**If a change ships behind a feature flag** (see
[docs/operations/feature-flags.md](./operations/feature-flags.md)), its
entry is written when the flag is actually **enabled** for the audience the
entry describes - never at merge time, since the code may ship dark for a
while first. An entry announcing something not yet visible to anyone is
inaccurate regardless of good intentions.

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

**Post-release verification** (checked 2026-08-11): the trend UI shipped to
production in #327 - `main` deploys on every merge (ADR-011) - before this
entry was drafted, so this section records an actual re-verification of
live behavior rather than a pre-release gate.

Production testing confirmed the comparable-trend and `N/A vs. last period`
states render correctly with live data. The remaining states (favorability
coloring, `New`, and a same-period correction alongside a trend badge on
one card) didn't have suitable production data available to exercise them
live at verification time, and remain covered by the automated test suite
instead. This file intentionally stays this general - see #329's PR
description for the specific evidence behind each of these statements.

Issues: #319, #320, #321, #322, #323, #324, #325.

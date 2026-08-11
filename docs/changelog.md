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

**Manual QA before this reaches beta users** (complements the automated
test suite - see #324):

- [ ] Member with two entries in the *same* period (a correction) - both
      "since last entry" and "vs. last period" show, with visibly
      different numbers and copy.
- [ ] Metric trending up on a "higher is better" metric - green badge.
- [ ] Metric trending up on a "lower is better" metric (e.g. an infraction
      count) - red badge, *not* green.
- [ ] Metric with no prior period at all (first period in the alliance) -
      "New" badge, not "N/A".
- [ ] Metric present this period but absent/voided in the prior period -
      "N/A vs. last period" badge.

Issues: #319, #320, #321, #322, #323, #324, #325.

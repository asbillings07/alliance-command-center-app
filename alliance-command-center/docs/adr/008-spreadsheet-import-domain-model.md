# ADR-008: Spreadsheet Import Domain Model

**Status:** Accepted

**Date:** 2026-07-10

## Context

Alliance Command Center originally approached spreadsheet import as a metric-mapping problem.

The proposed workflow assumed users would upload a CSV containing one metric and map:

- Player Name
- Metric Value

As discovery interviews continued and real alliance workbooks were collected from multiple alliances, this assumption proved incorrect.

Leaders rarely maintain spreadsheets containing a single metric.

Instead, they maintain operational workbooks that serve as the command center for their alliance.

These workbooks consistently contain:

- Historical snapshots
- Roster information
- Leadership metadata
- Operational planning
- Analytics and reporting

Importing spreadsheets therefore cannot be modeled as "CSV → Metric."

## Research Findings

Analysis of workbooks from multiple alliances revealed recurring patterns regardless of alliance size or maturity.

### Pattern 1 - Member Attributes

Data describing the current state of a member.

**Examples:**

- Player Name
- Rank
- HQ
- Power
- Profession
- Discord Status
- Leadership Role

**Characteristics:**

- Changes infrequently
- Represents identity
- Updates overwrite previous values

### Pattern 2 - Observations (Snapshots)

Time-based measurements collected repeatedly.

**Examples:**

- VS Points
- Kill Count
- Donations
- Desert Storm Score
- Capture Points
- Alliance Duel Score

**Characteristics:**

- Recorded repeatedly
- Historical
- Never overwrite previous observations
- Used for trend analysis

### Pattern 3 - Operational Data

Leadership-maintained information.

**Examples:**

- Leadership Notes
- Recruitment Pipeline
- Diplomacy
- Meeting Notes
- Succession Planning
- Training Assignments

**Characteristics:**

- Created manually
- Represents organizational knowledge
- Not imported from game exports

### Observation

Across every workbook analyzed, repeated measurements were organized around points in time, not around metrics.

Examples included:

- Kills on 3/29
- Kills on 6/3
- Kills on 6/28
- Week 47
- Week 48
- Week 49
- Monday
- Tuesday
- Wednesday
- Thursday
- Friday

These represent multiple observations of the same metric.

They do not represent different metrics.

## Decision

Alliance Command Center models imported data as **Snapshots** rather than individual metrics.

Conceptually:

```
Alliance
   ↓
Snapshot
   ↓
Member Measurements
```

A snapshot represents the state of one or more metrics at a specific point in time.

**Example:**

> June 28
>
> Dragon
>
> - Kills = 97M
> - VS = 21M
> - Donations = 48,000

Although the persistence model may continue storing individual `MemberMetricEntry` records, the application will treat them as belonging to a single snapshot during import.

## Import Philosophy

The purpose of importing is not to preserve spreadsheets.

The purpose of importing is to migrate operational data into Alliance Command Center.

Spreadsheets are considered transitional artifacts.

Alliance Command Center is the long-term source of truth.

## Import Categories

Rather than supporting a generic CSV importer, the application will support workflow-specific imports.

### Member Import

**Purpose:** Update member attributes.

**Examples:**

- HQ
- Power
- Profession
- Rank

### Snapshot Import

**Purpose:** Record observations for one or more metrics on a specific date.

**Examples:**

- VS
- Kill Count
- Donations
- Desert Storm

### Historical Import

**Purpose:** Import historical observations from reports containing multiple dates.

**Example:**

- Kills 6/3
- Kills 6/10
- Kills 6/17

The importer creates multiple snapshots automatically.

## Spreadsheet Classification

Before mapping columns, the importer should determine the workbook's intent.

Potential classifications include:

- Member Roster
- Snapshot
- Historical Tracking
- Operational Workbook

Different classifications may result in different import experiences.

## Presentation vs Source Data

Research consistently showed that workbooks contain both source data and calculated data.

**Examples of calculated data include:**

- Rankings
- Percent Increase
- Percentiles
- Participation Scores
- Averages
- Trend Indicators

These values should generally not be imported.

Alliance Command Center should calculate them dynamically from imported observations.

## Consequences

### Positive

- Aligns the product with real alliance workflows.
- Preserves historical observations.
- Eliminates importing calculated values.
- Supports richer analytics.
- Simplifies future reporting.

### Tradeoffs

- Import workflow becomes more opinionated.
- Spreadsheet classification is required.
- Generic CSV import becomes less flexible.

## Future Considerations

Possible future enhancements include:

- Automatic workbook classification.
- Header recognition using heuristics.
- Date detection from column names.
- Automatic identification of calculated columns.
- Multi-sheet workbook support.
- Spreadsheet templates for common alliance workflows.

## Implications for Import UI

The import workflow should classify the workbook before showing mapping controls.

A user uploading a spreadsheet should first answer (or the system should infer): "What kind of data is this?"

- **Member Roster** → Show member attribute mapping
- **Snapshot** → Ask for the snapshot date, then show metric mapping
- **Historical Tracking** → Detect date columns, create multiple snapshots

This classification step is the bridge between this ADR and the product UI. Without it, the importer cannot know whether to treat columns as attributes to overwrite or observations to append.

## Non-Goals

This ADR does not define:

- UI implementation.
- CSV parsing logic.
- OCR support.
- Spreadsheet template generation.
- Report generation.

Those will be addressed in future ADRs and implementation issues.

## Evidence

This decision is based on analysis of operational spreadsheets collected from multiple active Last War alliances, including:

- Historical kill tracking
- Weekly VS tracking
- Alliance roster management
- Participation dashboards
- Leadership operations workbooks
- Recruitment tracking
- Donation tracking

Despite differences in layout, the workbooks consistently organized data into three categories:

1. Member Attributes
2. Historical Observations (Snapshots)
3. Operational Leadership Data

This recurring pattern forms the conceptual model adopted by Alliance Command Center.

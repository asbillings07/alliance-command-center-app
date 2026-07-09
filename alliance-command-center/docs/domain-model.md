# Domain Model

## Purpose

This document defines the core business concepts of Alliance Command Center.

It serves as the shared language between engineering, product, and future contributors.

The domain model describes **what the business concepts represent**, not how they are implemented.

When adding new features, begin by identifying which existing domain object owns the new responsibility.

If no existing domain object is appropriate, consider introducing a new one.

---

# Core Philosophy

Alliance Command Center models alliance leadership, not the Last War game itself.

The goal is to represent the information leaders use to make decisions, preserve historical knowledge, and manage their alliance effectively.

Every domain object should exist because it represents a meaningful concept in the leadership process.

---

# Alliance

Represents a Last War alliance.

The Alliance is the primary tenant boundary within the application.

An Alliance owns:

* Members
* Metrics
* Leadership configuration
* Alliance memberships

An Alliance should never directly contain information that belongs to an individual member or user.

---

# User

Represents a person who can log into Alliance Command Center.

Users authenticate with the platform.

A User may belong to multiple alliances.

Users are responsible for performing actions such as:

* Creating leadership notes
* Recording metric entries
* Managing alliance settings
* Reviewing reports

A User is **not** necessarily a tracked player.

---

# Alliance Membership

Represents a User's relationship with an Alliance.

Responsibilities include:

* Role assignment
* Authorization
* Membership management

Example roles:

* OWNER
* ADMIN
* LEADER
* VIEWER

AllianceMembership exists because permissions belong to the relationship between a User and an Alliance—not to either object independently.

---

# Member

Represents a player being tracked by an Alliance.

Members are the primary subject of leadership evaluation.

A Member may have:

* Leadership Notes
* Metric Entries
* Participation history
* Availability information

Members do not authenticate.

Members may never log into the application.

A tracked player and a platform User are intentionally separate concepts.

---

# Metric

Represents a configurable evaluation criterion defined by an Alliance.

Examples include:

* VS Score
* Meteor Participation
* Battle Participation
* Communication
* Leadership Potential

Metrics are configurable because different alliances value different behaviors.

Metrics define **what is measured**, not the measured value itself.

---

# Member Metric Entry

Represents a historical measurement of a Member for a specific Metric.

Examples:

* VS Score = 92
* Battle Participation = 100
* Communication = 85

Metric Entries are immutable historical records.

They provide the foundation for:

* Trend analysis
* Historical reporting
* Weighted scoring
* Member rankings

Current scores should always be derived from historical entries rather than replacing them.

---

# Leadership Note

Represents a qualitative observation made by a leader about a Member.

Examples include:

* Positive recognition
* Warning
* Promotion recommendation
* Demotion recommendation
* General observation

Leadership Notes complement objective metrics by capturing context that cannot be represented numerically.

Leadership Notes represent organizational knowledge and should generally be preserved.

---

# Historical Data

Historical information is a first-class concept within the application.

Historical records should be preserved whenever possible.

Examples include:

* Leadership Notes
* Metric Entries
* Participation history

Historical information enables:

* Trend analysis
* Promotion decisions
* Leadership continuity
* Organizational memory

---

# Calculated Data

Calculated values are derived from historical information.

Examples include:

* Current weighted score
* Member ranking
* Contribution score
* Reliability score

Calculated values should generally not be stored in the database.

Instead, they should be computed from historical records.

---

# Relationships

```text
User
    │
    ▼
AllianceMembership
    │
    ▼
Alliance
    │
    ├── Members
    │      ├── Leadership Notes
    │      └── Member Metric Entries
    │
    └── Metrics
```

This relationship structure defines the current business domain.

Future features should extend this model rather than introducing parallel concepts.

---

# Adding New Features

When introducing new functionality, ask:

1. Which domain object owns this responsibility?

2. Is this historical information?

3. Is this configuration?

4. Is this a calculated value?

5. Does this belong to a User, Member, or Alliance?

6. Does this cross tenant boundaries?

The answers should guide where new functionality belongs.

---

# Domain Evolution

The domain model will continue to evolve as customer discovery continues.

Potential future domain objects include:

* Meeting
* Recruitment Pipeline
* Diplomacy
* Alliance Family
* Notification
* Event
* Report

New domain objects should only be introduced when they represent meaningful business concepts that cannot naturally belong to an existing object.

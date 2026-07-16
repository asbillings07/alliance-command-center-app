# ADR-009: Design System Architecture

## Status

Accepted

## Context

Alliance Command Center has grown organically, resulting in two parallel visual systems:

1. **Dark system** (auth, onboarding, platform): Uses documented hex tokens from `docs/color-design-principles.md`
2. **Light system** (members, metrics, periods): Uses default Tailwind grays

Additionally:

- **No shared UI components** - Every button, card, and input is inline Tailwind, duplicated across ~50 files
- **Inconsistent patterns** - Button padding, card borders, heading sizes, and spacing vary arbitrarily
- **Font conflict** - Geist fonts are loaded but `globals.css` forces Arial
- **Design documentation exists but isn't enforced** - `docs/color-design-principles.md` defines tokens that aren't wired into Tailwind

This creates several problems:

1. **Visual inconsistency** - Pages feel like they belong to different applications
2. **Maintenance burden** - Design changes require updating dozens of files
3. **Contributor confusion** - No clear guidance on how to build new UI
4. **Review subjectivity** - No objective criteria for UI consistency

## Decision

We establish a **design system** with distinct architectural layers:

```
Design Tokens → Foundations → Components → Patterns → Pages
```

### Core Principle

> **Pages describe structure. Components describe appearance. Design tokens describe visual language.**

This separation is enforced through architectural rules, not guidelines.

### Layer Definitions

| Layer | Responsibility | Ownership |
|-------|----------------|-----------|
| **Design Tokens** | Visual language (colors, semantic values) | `tailwind.config.ts`, CSS variables |
| **Foundations** | Rules (typography scale, spacing scale, elevation, radius) | Documentation + Tailwind config |
| **Components** | Building blocks (`Button`, `Card`, `Input`, `Badge`) | `app/src/components/` |
| **Patterns** | Compositions (Page Layout, Empty State, Data Table) | Documentation + composite components |
| **Pages** | Structure only | Route files in `app/` |

### Architectural Principles

1. **Pages describe structure. Components describe appearance. Design tokens describe visual language.**

2. **Components express intent, not implementation.**
   - Write: `<Button variant="primary">`
   - Not: `<Button className="bg-blue-600">`

3. **No page owns its own styling.**
   - Pages compose patterns and components
   - Pages never define colors, typography, or spacing

4. **Zero design decisions in page files.**
   - Layout classes (`w-full`, `flex`, `grid`) are acceptable
   - Design classes (`bg-red-500`, `text-2xl`, `rounded-lg`) are not

### Product Principles

5. **Information density over whitespace** - Leaders manage 100+ members; don't waste space

6. **One primary action per page** - Every page answers "What should I do next?"

7. **Neutral colors by default** - Gray, white, black; blue for actions; red for destructive; green only for success

8. **Consistency beats creativity** - Every page should feel familiar, not unique

9. **Data first** - This is a leadership tool, not a marketing site

## Foundations

Foundations are rules, not React components. They are documented and enforced through Tailwind configuration.

### Typography Scale

| Name | Usage | Implementation |
|------|-------|----------------|
| Display | Hero text, landing pages | `text-3xl font-bold` |
| Page Title | H1 on every page | `text-2xl font-bold` |
| Section Title | H2, card headers | `text-lg font-semibold` |
| Body | Default text | `text-base` |
| Small | Secondary information | `text-sm` |
| Caption | Metadata, timestamps | `text-xs text-muted` |

### Spacing Scale

| Token | Value | Usage |
|-------|-------|-------|
| `xs` | 8px (0.5rem) | Tight gaps, icon spacing |
| `sm` | 16px (1rem) | Default gap, form spacing |
| `md` | 24px (1.5rem) | Section spacing |
| `lg` | 32px (2rem) | Page sections |
| `xl` | 48px (3rem) | Major divisions |

### Elevation

| Level | Usage | Implementation |
|-------|-------|----------------|
| Flat | Default surface | No shadow, `bg-surface` |
| Card | Content containers | `border border-border` |
| Dropdown | Menus, popovers | `shadow-lg` |
| Modal | Dialogs | `shadow-xl` |

### Border Radius

One standard: `rounded-lg` (8px). No mixing of radius values.

## Components

Components are the building blocks. Each expresses intent through variants.

### Button

| Variant | Usage |
|---------|-------|
| `primary` | Main action (blue, filled) |
| `secondary` | Alternative action (gray border) |
| `ghost` | Tertiary action (transparent) |
| `danger` | Destructive action (red) |
| `link` | Navigation (text only) |

### Card

Single consistent style using design tokens. No variant explosion.

### Input

Consistent form controls: Input, Textarea, Select, Checkbox, Label, FormError.

### Badge

| Variant | Usage |
|---------|-------|
| `success` | Positive status (green) |
| `warning` | Needs attention (amber) |
| `danger` | Critical issue (red) |
| `neutral` | Default/inactive (gray) |
| `info` | Informational (blue) |

### EmptyState

Single layout for all empty states: Icon → Title → Description → Action.

## Patterns

Patterns are compositional rules that combine components.

### Page Pattern

Every page follows this structure:

```
Breadcrumb
    ↓
Title
    ↓
Description (optional)
    ↓
Primary Action
    ↓
Content
```

Implemented via `PageLayout` component.

### Empty State Pattern

Every empty state follows this structure:

```
Icon
    ↓
Title
    ↓
Description
    ↓
Action
```

Implemented via `EmptyState` component.

### Data Table Pattern (future)

```
Filters
    ↓
Table
    ↓
Pagination
```

## Consequences

### Positive

- **Visual consistency** - Every page automatically looks like it belongs
- **Reduced maintenance** - Design changes propagate through tokens and components
- **Clear guidance** - Contributors know exactly how to build UI
- **Objective reviews** - Design checklist provides measurable criteria
- **Future-proof** - New features inherit the design system automatically

### Tradeoffs

- **Initial migration effort** - Existing pages must be updated to use new components
- **Reduced flexibility** - Intentional constraint on per-page customization
- **Learning curve** - Contributors must learn the component API

### Migration Strategy

Pages are migrated incrementally, one area at a time:

1. Platform (already closest to design system)
2. Auth flows (login, register, redeem, invite)
3. Setup (alliance setup checklist)
4. Members (roster, detail, notes)
5. Metrics/Periods (configuration pages)
6. Dashboard (alliance hub)

## Design Review Checklist

Every UI PR must satisfy:

- [ ] Uses PageLayout component
- [ ] Uses shared Button, Card, Badge, EmptyState, Input components
- [ ] Components express intent (`variant="primary"`) not implementation (`className="bg-blue"`)
- [ ] No design decisions in page files
- [ ] Primary action is obvious
- [ ] Empty states include a next step
- [ ] Loading and error states are handled
- [ ] Respects permission-based visibility
- [ ] Uses foundation spacing scale
- [ ] Uses foundation typography scale

## Related Documents

- `docs/color-design-principles.md` - Design token definitions
- `docs/design-system/foundations.md` - Foundation rules
- `docs/design-system/patterns.md` - Pattern documentation
- `docs/design-review-checklist.md` - PR review checklist

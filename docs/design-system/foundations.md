# Design System Foundations

Foundations are the rules that govern visual consistency. They are not React components - they are constraints that components and pages must follow.

## Typography

### Scale

| Name | Size | Weight | Line Height | Usage |
|------|------|--------|-------------|-------|
| **Display** | 30px (1.875rem) | Bold (700) | 1.2 | Hero text, landing pages |
| **Page Title** | 24px (1.5rem) | Bold (700) | 1.3 | H1 on every page |
| **Section Title** | 18px (1.125rem) | Semibold (600) | 1.4 | H2, card headers |
| **Body** | 16px (1rem) | Normal (400) | 1.5 | Default text |
| **Small** | 14px (0.875rem) | Normal (400) | 1.5 | Secondary information |
| **Caption** | 12px (0.75rem) | Normal (400) | 1.4 | Metadata, timestamps |

### Tailwind Classes

```tsx
// Display
className="text-3xl font-bold"

// Page Title
className="text-2xl font-bold"

// Section Title
className="text-lg font-semibold"

// Body (default, no class needed)
className="text-base"

// Small
className="text-sm"

// Caption
className="text-xs text-text-muted"
```

### Rules

1. **Page titles are always Page Title scale** - No exceptions
2. **Section headers are always Section Title scale** - Consistency across cards and sections
3. **Body text is the default** - Don't add typography classes unless departing from default
4. **Use Caption for metadata** - Timestamps, IDs, helper text

---

## Spacing

### Scale

| Token | Value | Tailwind | Usage |
|-------|-------|----------|-------|
| `xs` | 8px | `gap-2`, `p-2`, `m-2` | Tight gaps, icon spacing, inline elements |
| `sm` | 16px | `gap-4`, `p-4`, `m-4` | Default gap, form field spacing |
| `md` | 24px | `gap-6`, `p-6`, `m-6` | Section spacing, card padding |
| `lg` | 32px | `gap-8`, `p-8`, `m-8` | Page sections, major divisions |
| `xl` | 48px | `gap-12`, `p-12`, `m-12` | Page margins, hero sections |

### Rules

1. **Never invent spacing** - Only use values from the scale
2. **Use gap for flex/grid** - Prefer `gap-*` over margin between children
3. **Consistent page padding** - All pages use `p-8` (lg) as outer padding
4. **Card padding is md** - All cards use `p-6` (md) internal padding

### Common Patterns

```tsx
// Page container
<div className="max-w-4xl mx-auto p-8">

// Section gap
<div className="space-y-6">

// Form field spacing
<div className="space-y-4">

// Inline element gap
<div className="flex items-center gap-2">

// Card padding
<div className="p-6">
```

---

## Colors

Colors are defined in `docs/color-design-principles.md` and wired into Tailwind as custom classes.

### Surface Colors

| Token | Hex | Tailwind | Usage |
|-------|-----|----------|-------|
| `background` | #0F172A | `bg-background` | Application background |
| `surface` | #111827 | `bg-surface` | Cards, tables, navigation |
| `surface-secondary` | #1F2937 | `bg-surface-secondary` | Nested panels, inputs |
| `surface-elevated` | #273449 | `bg-surface-elevated` | Dialogs, popovers, hover |

### Border Colors

| Token | Hex | Tailwind | Usage |
|-------|-----|----------|-------|
| `border` | #374151 | `border-border` | Default borders |
| `border-hover` | #4B5563 | `border-border-hover` | Hover state borders |

### Text Colors

| Token | Hex | Tailwind | Usage |
|-------|-----|----------|-------|
| `text-primary` | #F9FAFB | `text-text-primary` | Primary text |
| `text-secondary` | #D1D5DB | `text-text-secondary` | Labels, descriptions |
| `text-muted` | #9CA3AF | `text-text-muted` | Dates, metadata, captions |
| `text-disabled` | #6B7280 | `text-text-disabled` | Disabled controls only |

### Accent Colors

| Token | Hex | Tailwind | Usage |
|-------|-----|----------|-------|
| `primary` | #3B82F6 | `bg-primary`, `text-primary` | Primary actions, links |
| `success` | #22C55E | `bg-success`, `text-success` | Positive status |
| `warning` | #F59E0B | `bg-warning`, `text-warning` | Needs attention |
| `danger` | #EF4444 | `bg-danger`, `text-danger` | Errors, destructive |

### Rules

1. **Use semantic tokens** - `bg-surface` not `bg-[#111827]`
2. **No arbitrary hex values** - All colors must come from the token system
3. **Accent colors are semantic** - Blue = action, Red = destructive, Green = success only

---

## Elevation

Elevation creates visual hierarchy through borders and shadows.

### Levels

| Level | Implementation | Usage |
|-------|----------------|-------|
| **Flat** | No border, no shadow | Default content areas |
| **Card** | `border border-border rounded-lg` | Content containers |
| **Dropdown** | `border border-border rounded-lg shadow-lg` | Menus, popovers |
| **Modal** | `border border-border rounded-lg shadow-xl` | Dialogs |

### Rules

1. **Cards use borders, not shadows** - Consistent with the documented design
2. **Shadows are reserved for overlays** - Dropdowns and modals only
3. **One card style** - No variation in card elevation

---

## Border Radius

### Standard

All rounded elements use `rounded-lg` (8px).

### Rules

1. **No mixing radius values** - Don't use `rounded`, `rounded-md`, `rounded-xl`
2. **Buttons match cards** - Both use `rounded-lg`
3. **Inputs match buttons** - Consistent form element radius
4. **Exception: Pills** - Use `rounded-full` only for pill-shaped badges or avatars

---

## Icons

### Size Scale

| Size | Dimensions | Usage |
|------|------------|-------|
| `sm` | 16x16 | Inline with small text |
| `md` | 20x20 | Default, inline with body |
| `lg` | 24x24 | Standalone, empty states |

### Tailwind Classes

```tsx
// Small (inline with caption)
className="w-4 h-4"

// Medium (default)
className="w-5 h-5"

// Large (empty states, headers)
className="w-6 h-6"
```

### Rules

1. **Icons inherit text color** - Use `currentColor` or let Tailwind handle it
2. **No colored icons** - Icons are monochrome unless representing semantic status
3. **Consistent sizing** - Use only the three defined sizes

---

## Focus States

### Standard

All interactive elements must show visible focus:

```tsx
className="focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background"
```

### Rules

1. **Focus must be visible** - Accessibility requirement
2. **Use ring, not outline** - Consistent with design
3. **Ring offset matches background** - Use `ring-offset-background`

---

## Animation

### Transitions

| Property | Duration | Easing |
|----------|----------|--------|
| Color | 150ms | ease |
| Background | 150ms | ease |
| Border | 150ms | ease |
| Shadow | 150ms | ease |
| Transform | 200ms | ease-out |

### Tailwind Class

```tsx
className="transition-colors duration-150"
className="transition-all duration-200"
```

### Rules

1. **Subtle transitions** - 150-200ms, never jarring
2. **No decorative animation** - Animation serves function, not decoration
3. **Respect reduced motion** - Use `motion-reduce:transition-none` where appropriate

# Design Review Checklist

Every UI pull request must satisfy these criteria. This turns consistency from a subjective opinion into an objective review.

## Layout

- [ ] **Uses PageLayout component** - Every page uses `<PageLayout>` with breadcrumb, title, and optional description/action
- [ ] **Correct max-width** - Data pages use `4xl`, forms use `lg`, dashboards use `6xl`
- [ ] **Consistent spacing** - Uses foundation scale (8, 16, 24, 32, 48) not arbitrary values

## Components

- [ ] **Uses shared components** - Button, Card, Badge, Input, EmptyState from `@/app/src/components`
- [ ] **Components express intent** - Uses `variant="primary"` not `className="bg-blue-600"`
- [ ] **No design decisions in page files** - Layout classes okay, design classes not
- [ ] **Correct component variants** - Primary for main action, secondary for alternatives, danger for destructive

## Typography

- [ ] **Uses typography scale** - Display, Page Title, Section Title, Body, Small, Caption
- [ ] **Page title is H1** - Only one H1 per page, uses `text-2xl font-bold`
- [ ] **Section titles are H2** - Uses `text-lg font-semibold`
- [ ] **Text colors from tokens** - `text-text-primary`, `text-text-secondary`, `text-text-muted`

## Forms

- [ ] **Labels are visible** - No placeholder-only labels
- [ ] **Required fields marked** - Red asterisk via `<Label required>`
- [ ] **Errors below fields** - Uses `<FormError>` component
- [ ] **Consistent field spacing** - `space-y-4` between fields
- [ ] **Actions at bottom** - Cancel/secondary left, primary right

## States

- [ ] **Primary action is obvious** - Clear what user should do next
- [ ] **Empty states guide users** - Uses `<EmptyState>` with action
- [ ] **Loading states handled** - Uses `<Button loading>` or skeleton
- [ ] **Error states handled** - Inline errors, not just console.error

## Permissions

- [ ] **Respects permission-based visibility** - No dead buttons
- [ ] **Actions check capabilities** - Uses `permissions.canX` not `role === "X"`
- [ ] **Unauthorized users redirected** - Not shown error messages for features they can't access

## Accessibility

- [ ] **Focus visible** - All interactive elements show focus ring
- [ ] **Labels connected** - Form inputs have associated labels
- [ ] **Color not sole indicator** - Status has text/icon in addition to color

## Code Quality

- [ ] **No inline hex colors** - Uses design token classes
- [ ] **No arbitrary spacing** - Uses foundation scale classes
- [ ] **No duplicate styling** - Extracts repeated patterns to components
- [ ] **Imports from barrel** - Uses `@/app/src/components` not individual files

---

## Quick Reference

### Correct

```tsx
// Uses PageLayout
<PageLayout title="Members" breadcrumb={[...]} action={<Button variant="primary">Add</Button>}>
  <Card>
    <EmptyState title="No members" action={<Button variant="primary">Import</Button>} />
  </Card>
</PageLayout>

// Components express intent
<Button variant="primary">Save</Button>
<Button variant="danger">Delete</Button>
<Badge variant="success">Active</Badge>

// Typography from scale
<h1 className="text-2xl font-bold text-text-primary">Title</h1>
<p className="text-sm text-text-muted">Description</p>

// Colors from tokens
<div className="bg-surface border-border text-text-primary">
```

### Incorrect

```tsx
// ❌ No PageLayout
<div className="p-8">
  <h1>Members</h1>
  ...
</div>

// ❌ Design decisions in page
<button className="bg-blue-600 text-white px-4 py-2 rounded">Save</button>
<span className="bg-green-100 text-green-800">Active</span>

// ❌ Arbitrary typography
<h1 className="text-xl font-medium text-gray-800">Title</h1>

// ❌ Hardcoded colors
<div className="bg-[#111827] border-[#374151]">
```

---

## When to Skip

Some situations may warrant exceptions:

1. **Third-party component styling** - When integrating external libraries
2. **One-off promotional content** - Landing pages, marketing (rare in ACC)
3. **Data visualization** - Charts may need custom colors

Document any exceptions in the PR description with justification.

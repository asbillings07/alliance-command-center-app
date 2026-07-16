# Design System Patterns

Patterns are compositional rules that combine components into consistent user experiences. They are not components themselves - they are blueprints that pages follow.

## Page Pattern

Every page in Alliance Command Center follows this structure:

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

### Implementation

Use the `PageLayout` component:

```tsx
import { PageLayout } from "@/app/src/components";
import { Button } from "@/app/src/components/client";

export default function MembersPage() {
  return (
    <PageLayout
      breadcrumb={[
        { label: "DAY1", href: "/alliances/123" },
        { label: "Members" }
      ]}
      title="Leadership Roster"
      description="Manage alliance members and their roles"
      action={<Button variant="primary">Add Member</Button>}
    >
      {/* Page content */}
    </PageLayout>
  );
}
```

### Rules

1. **Every page has a title** - No exceptions
2. **Breadcrumbs show navigation path** - Last item is current page (no link)
3. **One primary action** - The most important thing the user can do
4. **Description is optional** - Only include if it adds value
5. **Consistent max-width** - Use `4xl` for data pages, `lg` for forms

### Max Width Guidelines

| Page Type | Max Width | Example |
|-----------|-----------|---------|
| Data pages | `4xl` | Members roster, periods list |
| Detail pages | `4xl` | Member detail, period detail |
| Forms | `lg` | Create member, edit metric |
| Full-width | `6xl` | Dashboard, platform |

---

## Empty State Pattern

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

### Implementation

Use the `EmptyState` component:

```tsx
import { EmptyState } from "@/app/src/components";
import { Button } from "@/app/src/components/client";

// Icon can be any 24x24 SVG
function UsersIcon() {
  return (
    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
  );
}

<EmptyState
  icon={<UsersIcon />}
  title="No members yet"
  description="Import your roster or add members manually to get started."
  action={<Button variant="primary">Import Members</Button>}
/>
```

### Rules

1. **Icon is optional but recommended** - Adds visual interest
2. **Title states the current state** - "No members yet" not "Add members"
3. **Description guides the user** - What should they do next?
4. **Action enables progress** - Always include a primary action
5. **Secondary action optional** - Link to documentation or alternative path

### Empty State Types

| Type | When to Use |
|------|-------------|
| First-time | User hasn't created anything yet |
| No results | Search/filter returned nothing |
| No access | User doesn't have permission |
| Error | Something went wrong |

---

## Card Pattern

Cards contain related content and optional actions.

```
Header (optional)
    ↓
Body
    ↓
Footer (optional)
```

### Implementation

Use the `Card` component:

```tsx
import { Card } from "@/app/src/components";
import { Button } from "@/app/src/components/client";

<Card>
  <Card.Header action={<Button variant="link">Edit</Button>}>
    Member Details
  </Card.Header>
  <Card.Body>
    {/* Content */}
  </Card.Body>
  <Card.Footer>
    <Button variant="secondary">Cancel</Button>
    <Button variant="primary">Save</Button>
  </Card.Footer>
</Card>
```

### Rules

1. **Cards have consistent padding** - `p-6` (md) by default
2. **Header has optional action** - Edit link, expand button, etc.
3. **Footer aligns actions right** - Primary action on the far right
4. **No nested cards** - Use sections within a card instead

---

## Form Pattern

Forms follow a consistent structure.

```
Field Label
    ↓
Input
    ↓
Help Text / Error
    ↓
(repeat for each field)
    ↓
Actions
```

### Implementation

Use the form components:

```tsx
import { Card } from "@/app/src/components";
import { FormField, Input, Select, Button } from "@/app/src/components/client";

<Card>
  <form className="space-y-4">
    <FormField label="Player Name" required error={errors.name}>
      <Input name="name" error={!!errors.name} />
    </FormField>

    <FormField label="Role" required>
      <Select name="role">
        <option value="ADMIN">Admin</option>
        <option value="LEADER">Leader</option>
        <option value="VIEWER">Viewer</option>
      </Select>
    </FormField>

    <div className="flex justify-end gap-3 pt-4">
      <Button variant="secondary" type="button">Cancel</Button>
      <Button variant="primary" type="submit">Save</Button>
    </div>
  </form>
</Card>
```

### Rules

1. **Labels are always visible** - No placeholder-only labels
2. **Required fields are marked** - Red asterisk after label
3. **Errors appear below field** - Red text, not toast/alert
4. **Field spacing is consistent** - `space-y-4`
5. **Actions at bottom** - Cancel left (or first), primary right (or last)

---

## Data Table Pattern (Future)

Tables display collections of data with optional filtering.

```
Filters
    ↓
Table
    ↓
Pagination (if needed)
```

### Structure

```tsx
<Card padding="none">
  {/* Filters */}
  <div className="p-4 border-b border-border">
    <Filters />
  </div>
  
  {/* Table */}
  <table className="w-full">
    <thead className="bg-surface-secondary">
      <tr>
        <th className="px-4 py-3 text-left text-sm font-medium text-text-secondary">
          Name
        </th>
        {/* ... */}
      </tr>
    </thead>
    <tbody className="divide-y divide-border">
      {/* rows */}
    </tbody>
  </table>
  
  {/* Pagination */}
  <div className="p-4 border-t border-border">
    <Pagination />
  </div>
</Card>
```

### Rules

1. **Tables in cards with no padding** - `<Card padding="none">`
2. **Header row has background** - `bg-surface-secondary`
3. **Rows have hover state** - `hover:bg-surface-elevated`
4. **Text is left-aligned** - Except numbers (right) and actions (center)
5. **Actions in last column** - Edit, delete, etc.

---

## Composition Examples

### Members Page

```tsx
<PageLayout
  breadcrumb={[{ label: "DAY1", href: "/alliances/123" }, { label: "Members" }]}
  title="Leadership Roster"
  description="94 members"
  action={<Button variant="primary">Add Member</Button>}
>
  <Card padding="none">
    <div className="p-4 border-b border-border">
      <MembersFilter />
    </div>
    <MembersTable members={members} />
  </Card>
</PageLayout>
```

### Member Detail Page

```tsx
<PageLayout
  breadcrumb={[
    { label: "DAY1", href: "/alliances/123" },
    { label: "Members", href: "/alliances/123/members" },
    { label: "Dragon" }
  ]}
  title="Dragon"
  description="R5 · Admin"
>
  <div className="space-y-6">
    <Card>
      <Card.Header>Performance</Card.Header>
      <Card.Body>
        <PerformanceStats />
      </Card.Body>
    </Card>
    
    <Card>
      <Card.Header action={<Button variant="link">Add Note</Button>}>
        Leadership Notes
      </Card.Header>
      <Card.Body>
        {notes.length === 0 ? (
          <EmptyState
            title="No notes yet"
            description="Add a leadership note to track important information."
          />
        ) : (
          <NotesList notes={notes} />
        )}
      </Card.Body>
    </Card>
  </div>
</PageLayout>
```

### Empty Members Page

```tsx
<PageLayout
  breadcrumb={[{ label: "DAY1", href: "/alliances/123" }, { label: "Members" }]}
  title="Leadership Roster"
  action={<Button variant="primary">Add Member</Button>}
>
  <EmptyStateCard
    icon={<UsersIcon />}
    title="No members yet"
    description="Import your roster or add members manually to get started."
    action={<Button variant="primary">Import Members</Button>}
    secondaryAction={<Button variant="link">Add manually</Button>}
  />
</PageLayout>
```

import {
  PageLayout,
  Card,
  Badge,
  EmptyStateCard,
} from "@/app/src/components";
import {
  Button,
  Input,
  Textarea,
  Select,
  Checkbox,
  FormField,
} from "@/app/src/components/client";

/**
 * Design System Preview
 *
 * Living reference for all design system components.
 * Like GitHub Primer - shows foundations, components, and patterns.
 */
export default function DesignSystemPage() {
  return (
    <PageLayout
      title="Design System"
      description="Alliance Command Center component library and patterns"
      maxWidth="6xl"
    >
      <div className="space-y-12">
        {/* Foundations */}
        <section>
          <h2 className="text-xl font-bold text-text-primary mb-6">
            Foundations
          </h2>

          {/* Colors */}
          <Card className="mb-6">
            <Card.Header>Colors</Card.Header>
            <Card.Body>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <ColorSwatch name="background" color="bg-background" />
                <ColorSwatch name="surface" color="bg-surface" />
                <ColorSwatch name="surface-secondary" color="bg-surface-secondary" />
                <ColorSwatch name="surface-elevated" color="bg-surface-elevated" />
                <ColorSwatch name="primary" color="bg-primary" />
                <ColorSwatch name="success" color="bg-success" />
                <ColorSwatch name="warning" color="bg-warning" />
                <ColorSwatch name="danger" color="bg-danger" />
              </div>
            </Card.Body>
          </Card>

          {/* Typography */}
          <Card className="mb-6">
            <Card.Header>Typography</Card.Header>
            <Card.Body className="space-y-4">
              <div>
                <span className="text-xs text-text-muted block mb-1">Display</span>
                <p className="text-3xl font-bold text-text-primary">Display Text</p>
              </div>
              <div>
                <span className="text-xs text-text-muted block mb-1">Page Title</span>
                <p className="text-2xl font-bold text-text-primary">Page Title</p>
              </div>
              <div>
                <span className="text-xs text-text-muted block mb-1">Section Title</span>
                <p className="text-lg font-semibold text-text-primary">Section Title</p>
              </div>
              <div>
                <span className="text-xs text-text-muted block mb-1">Body</span>
                <p className="text-base text-text-primary">Body text for reading content.</p>
              </div>
              <div>
                <span className="text-xs text-text-muted block mb-1">Small</span>
                <p className="text-sm text-text-secondary">Small text for secondary information.</p>
              </div>
              <div>
                <span className="text-xs text-text-muted block mb-1">Caption</span>
                <p className="text-xs text-text-muted">Caption text for metadata and timestamps.</p>
              </div>
            </Card.Body>
          </Card>

          {/* Spacing */}
          <Card>
            <Card.Header>Spacing Scale</Card.Header>
            <Card.Body>
              <div className="flex items-end gap-4">
                <SpacingSwatch name="xs" size="8px" className="w-2 h-2" />
                <SpacingSwatch name="sm" size="16px" className="w-4 h-4" />
                <SpacingSwatch name="md" size="24px" className="w-6 h-6" />
                <SpacingSwatch name="lg" size="32px" className="w-8 h-8" />
                <SpacingSwatch name="xl" size="48px" className="w-12 h-12" />
              </div>
            </Card.Body>
          </Card>
        </section>

        {/* Components */}
        <section>
          <h2 className="text-xl font-bold text-text-primary mb-6">
            Components
          </h2>

          {/* Buttons */}
          <Card className="mb-6">
            <Card.Header>Button</Card.Header>
            <Card.Body className="space-y-6">
              <div>
                <p className="text-sm text-text-muted mb-3">Variants</p>
                <div className="flex flex-wrap gap-3">
                  <Button variant="primary">Primary</Button>
                  <Button variant="secondary">Secondary</Button>
                  <Button variant="ghost">Ghost</Button>
                  <Button variant="danger">Danger</Button>
                  <Button variant="link">Link</Button>
                </div>
              </div>
              <div>
                <p className="text-sm text-text-muted mb-3">Sizes</p>
                <div className="flex flex-wrap items-center gap-3">
                  <Button variant="primary" size="sm">Small</Button>
                  <Button variant="primary" size="md">Medium</Button>
                  <Button variant="primary" size="lg">Large</Button>
                </div>
              </div>
              <div>
                <p className="text-sm text-text-muted mb-3">States</p>
                <div className="flex flex-wrap gap-3">
                  <Button variant="primary" disabled>Disabled</Button>
                  <Button variant="primary" loading>Loading</Button>
                </div>
              </div>
            </Card.Body>
          </Card>

          {/* Badges */}
          <Card className="mb-6">
            <Card.Header>Badge</Card.Header>
            <Card.Body className="space-y-4">
              <div>
                <p className="text-sm text-text-muted mb-3">Variants</p>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="success">Success</Badge>
                  <Badge variant="warning">Warning</Badge>
                  <Badge variant="danger">Danger</Badge>
                  <Badge variant="neutral">Neutral</Badge>
                  <Badge variant="info">Info</Badge>
                </div>
              </div>
              <div>
                <p className="text-sm text-text-muted mb-3">Sizes</p>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="info" size="sm">Small</Badge>
                  <Badge variant="info" size="md">Medium</Badge>
                </div>
              </div>
            </Card.Body>
          </Card>

          {/* Form Controls */}
          <Card className="mb-6">
            <Card.Header>Form Controls</Card.Header>
            <Card.Body className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField label="Input" required>
                  <Input placeholder="Enter text..." />
                </FormField>

                <FormField label="Input with error" error="This field is required">
                  <Input placeholder="Enter text..." error />
                </FormField>

                <FormField label="Select">
                  <Select>
                    <option value="">Select an option...</option>
                    <option value="1">Option 1</option>
                    <option value="2">Option 2</option>
                    <option value="3">Option 3</option>
                  </Select>
                </FormField>

                <FormField label="Textarea">
                  <Textarea placeholder="Enter longer text..." rows={3} />
                </FormField>
              </div>

              <div>
                <p className="text-sm text-text-muted mb-3">Checkbox</p>
                <div className="space-y-2">
                  <Checkbox id="check1" label="Option 1" />
                  <Checkbox id="check2" label="Option 2" defaultChecked />
                </div>
              </div>
            </Card.Body>
          </Card>

          {/* Cards */}
          <Card className="mb-6">
            <Card.Header>Card</Card.Header>
            <Card.Body>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card>
                  <Card.Header>Card Header</Card.Header>
                  <Card.Body>
                    <p className="text-sm text-text-secondary">
                      Card body content goes here. Cards are the primary container
                      for content in the design system.
                    </p>
                  </Card.Body>
                  <Card.Footer>
                    <Button variant="secondary" size="sm">Cancel</Button>
                    <Button variant="primary" size="sm">Save</Button>
                  </Card.Footer>
                </Card>

                <Card>
                  <Card.Header action={<Button variant="link" size="sm">Edit</Button>}>
                    Card with Action
                  </Card.Header>
                  <Card.Body>
                    <p className="text-sm text-text-secondary">
                      Cards can have header actions for quick operations.
                    </p>
                  </Card.Body>
                </Card>
              </div>
            </Card.Body>
          </Card>

          {/* Empty States */}
          <Card>
            <Card.Header>Empty State</Card.Header>
            <Card.Body>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <EmptyStateCard
                  icon={<PlaceholderIcon />}
                  title="No items yet"
                  description="Get started by creating your first item."
                  action={<Button variant="primary" size="sm">Create Item</Button>}
                />

                <EmptyStateCard
                  title="No results"
                  description="Try adjusting your search or filters."
                  action={<Button variant="secondary" size="sm">Clear Filters</Button>}
                />
              </div>
            </Card.Body>
          </Card>
        </section>

        {/* Patterns */}
        <section>
          <h2 className="text-xl font-bold text-text-primary mb-6">
            Patterns
          </h2>

          <Card>
            <Card.Header>Page Layout Pattern</Card.Header>
            <Card.Body className="space-y-4">
              <p className="text-sm text-text-secondary">
                Every page follows this structure:
              </p>
              <div className="bg-surface-secondary rounded-lg p-4 font-mono text-sm text-text-muted">
                <p>Breadcrumb</p>
                <p className="ml-4">↓</p>
                <p>Title</p>
                <p className="ml-4">↓</p>
                <p>Description (optional)</p>
                <p className="ml-4">↓</p>
                <p>Primary Action</p>
                <p className="ml-4">↓</p>
                <p>Content</p>
              </div>
              <p className="text-sm text-text-muted">
                See{" "}
                <code className="text-xs bg-surface-secondary px-1 py-0.5 rounded">
                  docs/design-system/patterns.md
                </code>{" "}
                for full documentation.
              </p>
            </Card.Body>
          </Card>
        </section>
      </div>
    </PageLayout>
  );
}

// Helper components for the preview page

function ColorSwatch({ name, color }: { name: string; color: string }) {
  return (
    <div className="space-y-2">
      <div className={`h-16 rounded-lg border border-border ${color}`} />
      <p className="text-xs text-text-muted font-mono">{name}</p>
    </div>
  );
}

function SpacingSwatch({
  name,
  size,
  className,
}: {
  name: string;
  size: string;
  className: string;
}) {
  return (
    <div className="text-center">
      <div className={`${className} bg-primary rounded`} />
      <p className="text-xs text-text-muted mt-2">{name}</p>
      <p className="text-xs text-text-disabled">{size}</p>
    </div>
  );
}

function PlaceholderIcon() {
  return (
    <svg
      className="w-6 h-6"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
      />
    </svg>
  );
}

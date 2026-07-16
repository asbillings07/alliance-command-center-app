import { Page, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Accessibility Testing Utilities
 *
 * Provides helpers for automated accessibility testing using axe-core.
 *
 * Usage in tests:
 *   import { checkA11y, checkA11yWithOptions } from '../shared/accessibility';
 *
 *   test('page is accessible', async ({ page }) => {
 *     await page.goto('/some-page');
 *     await checkA11y(page);
 *   });
 */

/**
 * Run axe-core accessibility scan on the current page.
 * Fails the test if any violations are found.
 */
export async function checkA11y(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();

  if (results.violations.length > 0) {
    const violationMessages = results.violations.map((violation) => {
      const nodes = violation.nodes
        .map((node) => `  - ${node.html}`)
        .join("\n");
      return `${violation.id}: ${violation.description}\n${nodes}`;
    });

    throw new Error(
      `Accessibility violations found:\n\n${violationMessages.join("\n\n")}`
    );
  }

  expect(results.violations).toEqual([]);
}

/**
 * Run axe-core with custom options.
 * Useful for excluding specific rules or targeting specific elements.
 */
export async function checkA11yWithOptions(
  page: Page,
  options: {
    exclude?: string[];
    include?: string[];
    disableRules?: string[];
    runOnly?: string[];
  }
): Promise<void> {
  let builder = new AxeBuilder({ page });

  if (options.exclude) {
    for (const selector of options.exclude) {
      builder = builder.exclude(selector);
    }
  }

  if (options.include) {
    for (const selector of options.include) {
      builder = builder.include(selector);
    }
  }

  if (options.disableRules) {
    builder = builder.disableRules(options.disableRules);
  }

  if (options.runOnly) {
    builder = builder.withTags(options.runOnly);
  }

  const results = await builder.analyze();

  if (results.violations.length > 0) {
    const violationMessages = results.violations.map((violation) => {
      const nodes = violation.nodes
        .map((node) => `  - ${node.html}`)
        .join("\n");
      return `${violation.id}: ${violation.description}\n${nodes}`;
    });

    throw new Error(
      `Accessibility violations found:\n\n${violationMessages.join("\n\n")}`
    );
  }

  expect(results.violations).toEqual([]);
}

/**
 * Check only WCAG 2.1 Level A violations.
 * This is the minimum compliance level.
 */
export async function checkA11yLevelA(page: Page): Promise<void> {
  return checkA11yWithOptions(page, {
    runOnly: ["wcag2a"],
  });
}

/**
 * Check WCAG 2.1 Level AA violations.
 * This is the standard compliance level for most regulations.
 */
export async function checkA11yLevelAA(page: Page): Promise<void> {
  return checkA11yWithOptions(page, {
    runOnly: ["wcag2a", "wcag2aa"],
  });
}

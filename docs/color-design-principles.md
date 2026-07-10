# Color Design Principles

## Purpose

This document defines the color philosophy and visual language for Alliance Command Center.

Color is not decoration.

Color is a communication tool that should improve readability, reinforce hierarchy, and help alliance leaders make faster and more confident decisions.

Every color choice should have a purpose.

---

# Core Philosophy

## Readability Over Branding

Readability is the highest priority.

If a branding decision negatively impacts readability, accessibility, or usability, readability always wins.

Alliance leaders spend long periods reviewing member information, metrics, leadership notes, and reports.

The interface should remain comfortable to use during extended sessions.

---

## Calm Over Flashy

Alliance Command Center is a professional leadership tool.

The application should feel:

* Calm
* Confident
* Focused
* Trustworthy

Avoid:

* Neon colors
* Excessive gradients
* Highly saturated palettes
* Gaming-inspired aesthetics
* Decorative color usage

The interface should feel closer to GitHub, Linear, and Vercel than to the Last War game itself.

---

# Color System

The application should use a layered dark interface built on slate and neutral gray surfaces.

Avoid pure black.

Pure black creates excessive contrast and contributes to eye fatigue.

---

# Background Colors

## Application Background

```css
#0F172A
```

Purpose:

Primary application background.

---

## Primary Surface

```css
#111827
```

Purpose:

Cards

Tables

Navigation

Content containers

---

## Secondary Surface

```css
#1F2937
```

Purpose:

Nested panels

Secondary cards

Expanded sections

---

## Elevated Surface

```css
#273449
```

Purpose:

Dialogs

Popovers

Menus

Focused cards

Hover states

---

# Border Colors

Borders should provide subtle separation rather than visual emphasis.

## Default Border

```css
#374151
```

---

## Hover Border

```css
#4B5563
```

---

## Divider

```css
#374151
```

Avoid unnecessary dividers.

Whitespace should separate content whenever possible.

---

# Typography Colors

Typography should maintain excellent readability.

---

## Primary Text

```css
#F9FAFB
```

Nearly white.

Avoid pure white.

---

## Secondary Text

```css
#D1D5DB
```

Supporting information.

Examples:

* Labels
* Descriptions
* Secondary values

---

## Muted Text

```css
#9CA3AF
```

Examples:

* Dates
* Metadata
* Captions
* Helper text

---

## Disabled Text

```css
#6B7280
```

Used only for disabled controls.

Never use disabled colors for readable content.

---

# Primary Accent

Alliance Command Center should use a single primary accent color.

## Primary

```css
#3B82F6
```

Reasons:

* Professional
* High contrast
* Familiar
* Accessible
* Works well in dark mode

Primary actions should consistently use this color.

Avoid introducing additional brand colors.

---

# Semantic Colors

Semantic colors communicate status.

They should never be used decoratively.

---

## Success

```css
#22C55E
```

Examples:

* Positive participation
* Healthy status
* Completed actions

---

## Warning

```css
#F59E0B
```

Examples:

* Missing information
* Needs attention
* Moderate concern

---

## Error

```css
#EF4444
```

Examples:

* Failed actions
* Critical issues
* High-risk situations

---

## Information

```css
#3B82F6
```

Examples:

* Informational messages
* Active navigation
* Selected items

---

# Interactive States

## Hover

Hover states should primarily rely on subtle background changes.

Recommended hover surface:

```css
#273449
```

Avoid dramatic color shifts.

---

## Selected

Selection should be indicated using the primary accent color.

Selection should remain obvious without becoming distracting.

---

## Focus

Keyboard focus must always be visible.

Recommended:

* 2px outline
* Primary blue

Accessibility takes priority over aesthetics.

---

# Tables

Tables represent one of the most frequently used interfaces in the application.

Rows should alternate between:

Primary Surface

↓

Slightly Lighter Surface

↓

Primary Surface

Hover should use:

```css
#273449
```

Selected rows should use a subtle blue tint.

Avoid bright selection colors.

---

# Cards

Cards should use layered surfaces instead of heavy shadows.

Preferred:

Background

↓

Border

↓

Spacing

Avoid relying on shadows for hierarchy.

---

# Charts

Charts should emphasize information rather than decoration.

Guidelines:

* Muted default palette
* One highlighted series
* Minimal grid lines
* Thin strokes
* High contrast labels

Avoid gradients and unnecessary color variation.

---

# Status Indicators

Status should never rely solely on color.

Every status indicator should include:

* Text
* Icon
* Color

Example:

✓ Healthy

⚠ Needs Attention

✕ Critical

This improves accessibility and readability.

---

# Links

Links should use the primary accent color.

Default:

Primary Blue

Hover:

Slightly lighter blue

Underline only on hover.

---

# Icons

Icons should inherit surrounding text color unless representing semantic meaning.

Avoid colorful iconography throughout the interface.

---

# Dark Mode

Dark mode is the primary design target.

Many users interact with Alliance Command Center while also using:

* Discord
* Last War
* Other leadership tools

The dark experience should feel polished rather than simply inverted.

---

# Light Mode

Light mode should receive equal design consideration.

Colors should not simply be inverted.

Both themes should maintain:

* Consistent hierarchy
* Consistent spacing
* Consistent component behavior

---

# Accessibility

Every text/background combination must meet WCAG AA contrast requirements at a minimum.

Frequently used content should target AAA contrast whenever practical.

Accessibility is a product requirement, not an enhancement.

---

# Design Tokens

The following tokens should serve as the application's source of truth.

```css
--background: #0F172A;

--surface: #111827;
--surface-secondary: #1F2937;
--surface-elevated: #273449;

--border: #374151;
--border-hover: #4B5563;

--text-primary: #F9FAFB;
--text-secondary: #D1D5DB;
--text-muted: #9CA3AF;
--text-disabled: #6B7280;

--primary: #3B82F6;

--success: #22C55E;
--warning: #F59E0B;
--danger: #EF4444;
```

These values should be defined as design tokens and reused throughout the application.

Avoid hardcoding colors within components.

---

# Future Evolution

As the design system matures, additional semantic tokens may be introduced for:

* Charts
* Data visualizations
* Badges
* Score indicators
* Heat maps

New colors should extend the existing palette rather than introducing entirely new visual languages.

---

# Guiding Principle

Color should never compete with information.

Its purpose is to improve readability, reinforce hierarchy, communicate meaning, and help alliance leaders make better decisions with confidence.

When a choice exists between visual flair and clarity, clarity always wins.

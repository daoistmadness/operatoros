---
version: alpha
name: OperatorOS
description: An accessible, data-dense design system for school attendance, academic operations, and analytical reporting.
colors:
  primary: "#4f46e5"
  primary-hover: "#4338ca"
  primary-foreground: "#ffffff"
  background: "#f8fafc"
  foreground: "#0f172a"
  surface: "#ffffff"
  surface-muted: "#f1f5f9"
  border: "#e2e8f0"
  muted-foreground: "#526176"
  focus-ring: "#4f46e5"
  success: "#047857"
  success-surface: "#ecfdf5"
  warning: "#d97706"
  warning-foreground: "#78350f"
  warning-surface: "#fffbeb"
  danger: "#be123c"
  danger-surface: "#fff1f2"
  information: "#2563eb"
  information-surface: "#eff6ff"
  late: "#ea580c"
  late-foreground: "#9a3412"
  late-surface: "#fff7ed"
typography:
  page-title:
    fontFamily: Inter, system-ui, sans-serif
    fontSize: 1.875rem
    fontWeight: 900
    lineHeight: 1.2
    letterSpacing: -0.025em
  section-title:
    fontFamily: Inter, system-ui, sans-serif
    fontSize: 1.125rem
    fontWeight: 900
    lineHeight: 1.4
    letterSpacing: -0.025em
  body:
    fontFamily: Inter, system-ui, sans-serif
    fontSize: 0.875rem
    fontWeight: 400
    lineHeight: 1.625
  label:
    fontFamily: Inter, system-ui, sans-serif
    fontSize: 0.875rem
    fontWeight: 700
    lineHeight: 1.25
  overline:
    fontFamily: Inter, system-ui, sans-serif
    fontSize: 0.75rem
    fontWeight: 900
    lineHeight: 1.25
    letterSpacing: 0.18em
  table-header:
    fontFamily: Inter, system-ui, sans-serif
    fontSize: 0.75rem
    fontWeight: 900
    lineHeight: 1.25
    letterSpacing: 0.025em
rounded:
  sm: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  xs: 0.25rem
  sm: 0.5rem
  md: 1rem
  lg: 1.5rem
  xl: 2rem
  xxl: 3rem
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    height: 2.5rem
    padding: 1rem
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.primary-foreground}"
  button-secondary:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    height: 2.5rem
    padding: 1rem
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    padding: 1.5rem
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    height: 2.75rem
    padding: 0.75rem
  table:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
  table-divider:
    backgroundColor: "{colors.border}"
    textColor: "{colors.foreground}"
    height: 1px
  table-header:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.muted-foreground}"
    typography: "{typography.table-header}"
  focus-visible:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.focus-ring}"
    rounded: "{rounded.sm}"
  status-present:
    backgroundColor: "{colors.success-surface}"
    textColor: "{colors.success}"
    rounded: "{rounded.full}"
  status-sick:
    backgroundColor: "{colors.information-surface}"
    textColor: "{colors.information}"
    rounded: "{rounded.full}"
  status-permitted:
    backgroundColor: "{colors.warning-surface}"
    textColor: "{colors.warning-foreground}"
    rounded: "{rounded.full}"
  status-permitted-indicator:
    backgroundColor: "{colors.warning}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.full}"
  status-absent:
    backgroundColor: "{colors.danger-surface}"
    textColor: "{colors.danger}"
    rounded: "{rounded.full}"
  status-late:
    backgroundColor: "{colors.late-surface}"
    textColor: "{colors.late-foreground}"
    rounded: "{rounded.full}"
  status-late-indicator:
    backgroundColor: "{colors.late}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.full}"
---

# OperatorOS Design System

## Overview

OperatorOS is a data-dense operational interface for school administrators. Its visual language is calm, precise, and dependable: cool slate foundations, white work surfaces, indigo actions, compact information hierarchy, and strong labels that remain legible during repetitive work.

This document is the authoritative design-language contract for the frontend. The YAML tokens are normative values. The prose explains how to apply them. Runtime tokens remain implemented in `src/index.css`; shared React primitives remain implemented in `src/components/ui` and `src/components/common`. When implementation and this document diverge, reconcile them deliberately rather than adding a page-local substitute.

Design for real operator conditions: long names, large tables, incomplete records, slow requests, keyboard use, narrow screens, and printed reports. Favor clarity and predictable placement over decoration.

## Colors

Use semantic tokens instead of raw colors when a token exists.

- **Primary:** Indigo identifies the main action, selected navigation, focus, and branded emphasis. Reserve it for interaction and hierarchy; do not flood large backgrounds with it.
- **Neutral foundation:** `background` is the application canvas, `surface` holds cards and controls, `surface-muted` separates secondary regions and table headers, and `border` provides quiet structure.
- **Text:** `foreground` is primary content. `muted-foreground` is supporting copy and metadata, never a substitute for disabled styling or a sole status signal.
- **Attendance semantics:** Hadir/on-time is success green, Terlambat is orange, Sakit is information blue, Izin is warning amber, and Alfa is danger rose/red. Preserve these mappings everywhere: badges, charts, tables, legends, and exports.
- **Status surfaces:** Pair each status foreground with its matching pale surface and a text label or icon. Never communicate status by color alone.
- **Focus:** The indigo focus ring must remain visible against both white and muted surfaces.

## Typography

Inter is the preferred face, followed by the system UI stack for offline resilience. Use tabular numerals for aligned metrics and time values.

- Page titles use the `page-title` token: compact, black weight, and tight tracking. On narrow screens the shared `PageHeader` may step down to 1.5rem.
- Section and card titles use `section-title`; keep heading levels semantic rather than selecting an element for its size.
- Body copy uses `body`. Avoid smaller text for instructions, errors, or essential metadata.
- Interactive labels use `label`. Strong weight is intentional for rapid scanning, but sentence case remains the default.
- Eyebrows and table headings use `overline` or `table-header`: uppercase, concise, and letter-spaced. Do not apply this treatment to paragraphs.
- Maintain a clear content hierarchy. Avoid arbitrary font sizes, decorative faces, and weight-only distinctions without structural headings.

## Layout

The application shell owns navigation and provides a centered content area with a maximum width of `80rem`. Pages should use responsive horizontal padding from 1rem on small screens to 2rem on large screens, and a primary vertical rhythm of 1.5rem.

- Begin feature pages with the shared `PageHeader`. Place title and description on the left and wrap page actions on the right; actions stack naturally on narrow screens.
- Use `Card` for bounded content and `FilterBar` for filter controls. Use responsive grids that collapse to one column before controls become cramped.
- Keep dense controls at least 2.5rem high; form inputs and native selects are 2.75rem high. Primary touch targets should approach 44px when the surrounding workflow permits.
- Use `DataTableContainer` for every wide table so horizontal scrolling belongs to the table region, never the page body. Sticky headers or first columns are acceptable when they preserve context.
- Keep action groups near the content they affect. Destructive actions must not visually compete with the primary workflow.
- At 390px, labels and actions must remain visible, cards must stay inside the viewport, and content must reflow without horizontal body overflow.

## Elevation & Depth

OperatorOS uses borders before shadows. Default cards use the subtle surface shadow from `--shadow-surface`; dialogs, drawers, and other temporary layers use `--shadow-elevated`. Strong `shadow-2xl` treatments are reserved for established modal or high-emphasis surfaces and should not spread to ordinary cards.

Depth must explain hierarchy. Do not stack shadows on nested cards, use elevation as a replacement for spacing, or add gradients and glass effects to routine operational screens. Overlays should clearly separate modal content while preserving adequate contrast.

## Shapes

The base radius is 0.75rem. Controls use `rounded-md`, shared cards and table containers use `rounded-lg`, and intentionally softer filter/state regions may use `rounded-xl`. Pills and compact status badges use `rounded-full`.

Use one radius family within a component. Avoid arbitrary radius values and excessive nesting of rounded containers. Square data cells and structured table interiors may sit inside one rounded outer container.

## Components

### Shared primitive rule

Before writing utilities, check `src/components/ui` and `src/components/common`. Reuse or extend an existing primitive when its semantics match. A new primitive is justified only when the pattern is reusable, inaccessible with the current API, or materially different in behavior—not because one page needs a visual variation.

### Buttons

Use `Button` for actions. Its default type is `button`; set `type="submit"` only for the form's actual submission action. Use one primary action per local decision area. Secondary and outline variants support adjacent actions; danger is reserved for destructive outcomes. Icon-only buttons require an accessible name. Disabled and loading states must prevent duplicate submission and remain understandable without color.

### Cards and structured regions

Use `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, and `CardFooter` for standard bounded content. Avoid recreating the card utility bundle inline. Use `FilterBar` for query controls and `ActionGroup` for related actions. Do not nest cards merely to create padding.

### Forms

Compose fields with `FormField`, `FieldLabel`, `FieldDescription`, and `FieldError`, then use the shared input, select, checkbox, or textarea control. Preserve programmatic labels, required announcements, `aria-describedby`, invalid state, visible focus, and error text. Placeholder text is never the only label. Keep validation close to the affected field and provide a summary only when it improves recovery.

### Tables

Use the shared data-table family for new standard tables. Header cells need correct scope, rows need stable keys, and numeric values should align consistently. Tables must scroll inside `DataTableContainer` on narrow screens. Loading, empty, and error content must not masquerade as data rows unless the table semantics require a correctly spanned cell.

### Status, feedback, and overlays

Use `Badge` for compact state, `Alert` for consequential inline feedback, and `LoadingState`, `EmptyState`, or `ErrorState` for region-level states. Loading regions use polite live announcements; errors use alert semantics. Use shared `Dialog` primitives for modal interactions so focus, labelling, dismissal, and overlay behavior remain coherent. Toasts must not be the sole record of a failed or destructive operation.

### Workflow patterns

- **Upload:** Show supported input expectations before selection, an explicit selected-file state, guarded submission with progress, and a durable result summary. Never expose real student data in client logs.
- **Configuration:** Group related fields, expose current values before editing, distinguish save from reset/delete, and retain context after success or error.
- **Reports:** Present filters before generation, disable exports until valid data exists, keep tables scrollable on screen, and retain `.report-section` print behavior with unclipped content and acceptable page breaks.
- **Analytics:** Pair chart color with labels, legends, or values; provide loading, empty, and error states; and preserve the canonical attendance color mapping.

## Do's and Don'ts

### Do

- Reuse shared primitives and semantic tokens before adding page-local utility strings.
- Preserve visible keyboard focus, descriptive accessible names, correct button types, and meaningful disabled/loading states.
- Test long Indonesian labels, large datasets, empty/error/loading states, keyboard navigation, narrow screens, and report printing.
- Keep tables within scroll containers and keep page-level overflow at zero.
- Keep status labels explicit and pair color with text, iconography, pattern, or position.
- Use Tailwind CSS 4 utilities and the variables in `src/index.css`; keep Chart.js canvas configuration as the documented exception to the no-inline-style rule.

### Don't

- Do not reintroduce global helper classes such as `.btn-primary` or `.card`.
- Do not duplicate the shared `Button`, `Card`, field, table, header, filter, or state-message utility bundles across pages.
- Do not introduce raw brand/status hex values when a semantic token or established Tailwind status palette applies.
- Do not use color alone, placeholder-only labels, invisible focus, icon-only actions without names, or clickable non-interactive elements.
- Do not allow loading actions to submit twice, hide errors only in transient notifications, or log real student data.
- Do not let cards, dialogs, controls, or tables force horizontal body overflow or clip labels and actions.

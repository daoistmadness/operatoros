# OperatorOS CSS and Component Architecture

## Styling hierarchy

```text
Tailwind utilities
  → owned shadcn-style primitives
  → CVA variants
  → common application components
  → feature components
  → route composition
```

`frontend/src/index.css` is the sole global CSS entry. New component-specific CSS files, inline style objects, duplicated literal colors, and feature-local theme values are not allowed. Chart.js canvas configuration remains the narrow inline-style exception.

## Ownership

- `components/ui`: presentation primitives only. No API calls, permissions, or business language.
- `components/common`: reusable OperatorOS composition such as page headers, loading panels, and empty states.
- `components/features`: domain components with report, backup, attendance, or academic language.
- `pages`: route composition and state wiring.

Primitives are copied into the repository and reviewed; they are not opaque package components. Radix may provide accessible behavior while OperatorOS owns styling and variants.

## Tokens

Semantic CSS variables live in `src/index.css` and are exposed to Tailwind through `@theme inline`. Tokens cover canvas/surface/text/border, primary, success, warning, danger, information, radius, shadows, focus ring, animation timing, and overlay/navigation/dialog z-index layers. Attendance status colors remain governed separately by the existing semantic mapping.

## Variants

Buttons support `primary`, `secondary`, `success`, `warning`, `danger`, `outline`, and `ghost`. Danger is reserved for restore, delete, and destructive administration. Components use `class-variance-authority` for stable variants and the shared `cn` utility for conflict resolution.

## Migration rule

Each screen is migrated completely: capture baseline, replace repeated controls/surfaces, remove that screen's obsolete classes/components, test, build, and capture the result. Legacy styling may exist only on screens not yet entered into the migration loop.

## Accessibility baseline

- All interactive elements have visible `focus-visible` rings.
- Controls have programmatic labels and errors use live/alert semantics.
- Dialogs trap focus, close on Escape, restore trigger focus, and label title/description.
- Motion respects `prefers-reduced-motion`.
- Controls retain usable sizing at 200% zoom and keyboard-only operation.

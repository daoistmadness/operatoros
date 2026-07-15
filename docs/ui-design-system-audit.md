# OperatorOS UI Design-System Audit

Audited 2026-07-14 before Phase 10 production-screen migration.

## Existing architecture

OperatorOS uses React 19, mixed JavaScript/TypeScript source, Vite 6, and Tailwind CSS 4 utility classes. Route pages compose domain components directly; there is no dedicated layout directory and no owned primitive layer. Shared UI behavior exists mainly in `SidebarNav`, feature folders, and repeated class strings.

The frontend contains one active global source stylesheet, `src/index.css`, plus a previously generated `src/tailwind.css` artifact. There are no CSS modules, styled-components, or component-specific stylesheets. Five source files contain inline style expressions; inspection shows these are Chart.js/dynamic visualization sizing or values and remain permitted by the project guardrails. Thirty-three source files use Tailwind classes, with repeated form, card, button, alert, loading, empty, and table patterns.

## CSS pipeline

- Vite processes imported CSS and PostCSS.
- Tailwind CSS 4 is already installed with `@tailwindcss/postcss`; Phase 10 standardizes on this stable PostCSS integration after the Vite-plugin installation spike could not resolve reliably in the local environment.
- `@import "tailwindcss"` supplies Preflight/reset, theme, and utilities.
- `src/index.css` is the only application CSS entry.
- Global selectors are limited to base body/focus/reduced-motion rules.
- Legacy `.card`, `.glass`, and `.btn-primary` component classes are duplicated by page-local utilities and should disappear as each migrated screen adopts owned primitives.

## Design inventory

### Color

- Primary: indigo `#6366f1`; hover `#4f46e5`.
- Background: slate 50; surfaces: white.
- Borders: slate 200/300.
- Primary text: slate 900/800; muted text: slate 500/600.
- Success: emerald; warning/permission: amber; danger/destructive: rose; informational/sick: blue; lateness: orange.
- Attendance semantics remain fixed: Hadir emerald, Terlambat orange, Sakit blue, Izin amber, Alfa rose/red.

### Typography

- System/Inter-compatible sans stack with no external CDN.
- Page headings: 30px, black weight, tight tracking.
- Section headings: 18–20px, bold/black.
- Body: 14–16px; labels/table metadata: 12–14px, semibold/bold.

### Layout and surfaces

- Desktop shell: fixed 256px sidebar and a 1280px maximum content column.
- Page rhythm commonly uses 24–32px gaps.
- Cards use white surfaces, slate borders, 16–24px radii, and subtle shadows.
- Forms use 44–48px controls; pages repeat border/focus classes manually.
- Tables use compact 12–14px typography, horizontal overflow, and slate row dividers.

## State patterns

- Loading: pulse skeletons and spinning Lucide icons.
- Errors: visible rose alerts, generally with `role="alert"`.
- Empty states: dashed or neutral bordered panels.
- Dialogs: custom fixed overlays; restore requires focus trapping and Escape handling from an owned dialog primitive.
- Forms: labels exist, though some wrap native controls rather than using explicit `htmlFor` relationships.

## Duplication and migration targets

Buttons, inputs, selects, cards, badges, alerts, and dialogs are repeated across Login, Settings, Backup Management, Executive Reports, Dashboard, and navigation. Phase 10 introduces owned primitives in `components/ui`, app-level composition in `components/common`, and domain components in `components/features`. Grade Matrix is excluded.

## Compatibility spike result

A temporary `TestCard.tsx` compiled Tailwind utilities successfully. All 98 tests and the production build passed, and the spike file was removed. Baseline build output was 1,069.19 kB JS (299.00 kB gzip) and 76.39 kB CSS (12.65 kB gzip), built in 8.46 seconds. The earlier static generated stylesheet measured 81.02 kB CSS (12.34 kB gzip).

# Phase 10 Instrumented Contrast Report

Date: 2026-07-14

Tool: Lighthouse 12.8.2 accessibility audit against rendered authenticated routes in headless Chrome. The audit used a disposable packaged backend, disposable administrator, and temporary cookie. Lighthouse's Windows cleanup emitted an `EPERM` after some runs, but each JSON report was written completely and parsed successfully before temporary cleanup.

## Rendered route results

| Route | Accessibility score | Color-contrast audit | Failing nodes |
| --- | ---: | --- | ---: |
| Dashboard / Attendance Summary / semantic table | 0.98 | Pass | 0 |
| Backup Management / alerts / inputs / selects / buttons / status/history table | 1.00 | Pass | 0 |
| Executive Reports / tabs / filters / disabled export actions | 1.00 | Pass | 0 |
| Login | 1.00 | Pass | 0 |

The initial audit correctly failed light slate helper text, indigo primary controls at 4.46:1, green status text, and table headers. Color-only remediation darkened shared brand, slate, emerald, rose, muted, and focus colors without changing layout or workflow. The same rendered-route audits then reported zero contrast failures.

## Component and state checks

| Component/state | Rendered or computed evidence | Result | Remediation |
| --- | --- | --- | --- |
| Primary button, normal | `#4f46e5` on white text, 6.29:1 | Pass | Darkened from `#6366f1` |
| Primary button, hover | `#4338ca` on white text, 7.90:1 | Pass | Darkened hover token |
| Focus indicator | `#4f46e5` against white, 6.29:1 | Pass (3:1 non-text threshold) | Darkened focus token |
| Secondary/helper text | `#64748b` on white, 4.76:1 | Pass | Darkened slate-400 |
| Muted/table-header text | `#526176` on slate-100, 5.76:1 | Pass | Darkened muted foreground |
| Success text/badge | `#047857` on white 5.48:1; on emerald-50 5.21:1 | Pass | Darkened emerald-600/success |
| Error/danger text | `#be123c` on white 6.29:1; on rose-50 5.72:1 | Pass | Darkened rose-600/danger |
| Disabled controls | Rendered and communicated as disabled | Exempt from WCAG contrast; state remains understandable | None |
| Inputs/selects/dialog/alerts | Covered on authenticated Backup Management and retained restore-dialog evidence | Pass | Shared tokens inherited |

No remaining contrast remediation is required for the audited Phase 10 acceptance surfaces.

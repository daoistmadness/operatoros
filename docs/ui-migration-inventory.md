# Phase 10 Migration Inventory

Audited 2026-07-14 before the final migration pass.

| Surface | Repeated controls/states | Adopted pattern |
| --- | --- | --- |
| Dashboard / Attendance Summary | Three native filters, raw export/mapping actions, legacy cards, bespoke loading/empty states, simple offenders table, custom mapping modal | PageHeader, FilterBar, FormField/NativeSelect, Button/Card, shared states, semantic DataTable presentation, Radix Dialog |
| Backup Management | Raw backup filter, seven scheduler inputs/selects, raw save action, bespoke loading/empty/error states, backup/history table presentation | Input, FormField/NativeSelect, Button, shared states, PageHeader, DataTable presentation while retaining TanStack behavior |
| Executive Reports | Five raw report selects, raw generate action, bespoke loading/empty/error states | PageHeader, FilterBar, FormField/NativeSelect, Button, shared states |
| Simple tables | Repeated overflow wrapper, header/cell spacing, row borders and empty markup | Semantic DataTable presentation wrappers; TanStack retained only where sorting/filtering already exists |

The Grade Matrix is explicitly excluded. No abstraction was added for a one-off business workflow.

# Development

Use `mise run dev` for normal development. The task delegates process
supervision to `./start-dev.sh`. Verified commands are maintained in
[`COMMANDS.md`](../../COMMANDS.md); stable decisions are maintained in
[`MEMORY.md`](../../MEMORY.md).

Use `mise run doctor` for read-only environment diagnostics,
`mise run check:affected` for Turbo checks against `origin/main`, and
`mise run check:full` for the complete release-sensitive gate.

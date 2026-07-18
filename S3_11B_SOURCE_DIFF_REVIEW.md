# S3.11B Source Diff Review

Review date: 2026-07-18

## Scope and findings

- Candidate: 80 explicit files; 4,611 insertions and 529 deletions before report documentation.
- No database, workbook, HAR, trace, runtime-state file, generated build output, deferred patch script, or sensitive report is staged.
- No production database path or credential was introduced.
- Test-only credentials are synthetic and confined to disposable E2E state.
- Two user-specific fallback paths found during review were removed from `e2e/run-smoke.sh` and `e2e/start-test-stack.sh`; both now resolve the account home dynamically.
- Port 5173 is only a preferred/default port. `start-dev.sh` and Vite consume synchronized runtime-selected ports, and auto mode skips unrelated listeners.
- Cleanup requires repository-scoped session records, PID start-time validation, same-user/repository ownership, and matching port records. Unknown or active ownership blocks termination.
- Bun 1.3.14 and genuine Node 22 are explicit modes. Node resolution rejects Bun substitution.
- `scripts/start-tauri-dev.ps1` rejects WSL UNC source paths, compares commits, requires clean source trees, and generates its override outside the repository under a session-specific `%LOCALAPPDATA%` directory.
- E2E databases must be absolute, disposable, and beneath `.runtime/operatoros-e2e`; production path equality is rejected. Enrollment fingerprints are compared before/after preview-only smoke behavior.
- Apache/Gibbon configuration is not referenced or modified.

## Verification evidence

| Check | Result |
|---|---|
| Clean candidate snapshot launcher/runtime tests | PASS, 16/16 |
| `timeout 300 make e2e-smoke` on clean candidate snapshot | PASS; backend 3/3, web 3/3, desktop skipped as blocked infrastructure |
| `git diff --cached --check` | PASS after removal of two trailing blank lines |
| Bash syntax | PASS |
| Python helper compilation | PASS |
| PowerShell AST syntax parse | PASS |
| WSL Bun frontend tests | PASS, 134/134 |
| WSL Bun frontend build | PASS (non-blocking chunk-size warning) |
| WSL genuine Node 22 frontend tests | PASS, 134/134 |
| WSL genuine Node 22 frontend build | PASS (non-blocking chunk-size warning) |
| Production database SHA-256 | `15c32b433f87872ef1d2021567e389fda434806d0f986a417d82baf8e0159fb8`, unchanged |
| Production `student_enrollments` | 0, read-only verification |

## Acceptance closure

Windows-native dependency installation, Bun Tauri acceptance, Node Tauri acceptance, source-commit equality, listener preservation, stale/failure cleanup, and normal managed-process shutdown all passed from clean clones. Detailed evidence is recorded in the dedicated S3.11B acceptance and cleanup reports.

# Development Tooling Simplification and Legacy Portless Removal

## Objective
Remove legacy `portless` development tooling and establish one reliable local development workflow using:
- FastAPI backend bound to loopback;
- Vite frontend bound to loopback;
- Vite `/api` proxy to FastAPI;
- One authoritative `start-dev.sh`;
- Predictable startup, readiness, shutdown, and port-collision behavior.

## Audit Checklist & Validation

### 1. Legacy Portless Removal
- **Status:** Verified.
- **Details:** Removed `start-dev.portless.sh.bak` and purged all obsolete references to `portless` across repository documentation (`AGENTS.md`, `CONVENTIONS.md`, `docs/UTILITY_SCRIPTS.md`, `docs/ACADEMIC_MANAGEMENT_WORKFLOW.md`). Zero active or fallback references to `portless` remain in the codebase.

### 2. Vite Dev Proxy Authority
- **Status:** Verified.
- **Details:**
  - `frontend/vite.config.js` transparently proxies all incoming `/api` HTTP and WebSocket traffic to the FastAPI backend bound on loopback (`http://127.0.0.1:<BACKEND_PORT>`).
  - Strict integer range validation (`1..65535`) ensures invalid port environments fail fast.
  - Maintains `process.env.FRONTEND_PORT ?? 5173` and `process.env.BACKEND_PORT ?? 8000` structure for full test suite compatibility.

### 3. Unified Dev Launcher (`start-dev.sh`)
- **Status:** Verified.
- **Details:**
  - Standardized on `start-dev.sh` as the sole authorized local development launcher.
  - Validates dynamic loopback port allocations for FastAPI and Vite with collision detection.
  - Guarantees clean process cleanup using OS process group signals (`setsid` / `trap`).
  - Strictly prevents target database contamination by rejecting execution against `backend/attendance.db`.

## Execution Outcomes

- **`bash -n start-dev.sh`:** passed
- **Dev Launcher unit tests (`test_dev_launcher.py`):** 16/16 passed
- **Vite runtime tests (`test_s311_dev_runtime.py`):** 4/4 passed
- **Frontend unit tests (Vitest - Bun & Node 22):** 196/196 passed
- **Backend pytest suite:** 528/528 passed
- **E2E Smoke gate:** 16/16 passed (Backend 4, Web 12)
- **Tauri desktop cargo tests & clippy:** passed
- **Protected database SHA-256:** `15c32b433f87872ef1d2021567e389fda434806d0f986a417d82baf8e0159fb8` (unchanged)
- **Enrollments count:** 0 (unchanged)

# OperatorOS Branding Migration — Discovery Audit Report

This report presents a repository-wide discovery scan for terms related to the product rebranding: `Astryx`, `astryx`, `OPREDEL`, `opredel`, `attendance analytics`, `Attendance Analytics`, `school-attendance-analytics`, and `Development Stack`.

## Confirmation of Existing Identity
We have verified that **both `Astryx` and `OPREDEL` appear in multiple code files and configurations** (over 60 occurrences for Astryx, and 5 occurrences for OPREDEL in source files). Therefore, this migration is a **complete replacement/rebranding pass** of both legacy names to **OperatorOS**.

---

## Safe Matches (To Be Updated in Phase 1)
Safe matches consist of user-facing UI text, CLI text banners, documentation descriptions, report headers/footers, and default branding configurations.

### 1. CLI Scripts & Process Banners
- **`start-dev.sh`**
  - Line 2: `# Reliable direct-process launcher for the Astryx development stack.` (Comment)
  - Line 58: `printf '\nNo Astryx services were started.\n'` (Error message)
  - Line 145: `printf 'Astryx Development Stack\n\nChecking environment...\n'` (Banner)
  - Line 259: `printf '\nStopping Astryx development stack...\n'` (Banner)
  - Line 271: `printf '\nStartup cancelled. No Astryx services were started.\n'` (Banner)
  - Line 334: `printf '\nAstryx development environment is ready. No services were started.\n'` (Banner)
  - Line 369: `printf '| Astryx Development Stack                                  |\n'` (Ready block header)
- **`scripts/verify-browser.sh`**
  - Line 3: `# Agent Browser smoke test for the school-attendance-analytics frontend.` (Comment)

### 2. Frontend HTML & Asset Copies (Including OPREDEL)
- **`frontend/index.html`**
  - Line 7: `<meta name="description" content="School Attendance Analytics - OPREDEL" />`
  - Line 8: `<title>School Attendance Analytics | OPREDEL</title>`
- **`frontend/public/index.html`**
  - Line 7: `<meta name="description" content="School Attendance Analytics - OPREDEL" />`
  - Line 8: `<title>School Attendance Analytics | OPREDEL</title>`
- **`frontend/src/pages/Login.tsx`**
  - Line 56: `<p className="text-xs font-black uppercase tracking-[0.2em] text-brand">Astryx</p>` (Card logo text)
  - Line 57: `<CardDescription>Use your local Astryx account to continue.</CardDescription>` (Card copy)
- **`frontend/src/pages/SetupAdmin.tsx`**
  - Line 77: `<p className="text-xs font-black uppercase tracking-[0.2em] text-brand">Astryx first run</p>` (Provisioning UI logo text)
- **`frontend/src/components/auth/SetupBoundary.tsx`**
  - Line 8: `Checking Astryx setup…` (Boundary fallback text)
- **`frontend/src/components/SidebarNav.jsx`**
  - Line 107: `<span className="font-bold text-xl tracking-tight text-slate-800">OPREDEL</span>` (Sidebar logo text)
- **`frontend/src/pages/Upload.js`**
  - Line 103: `<p className="text-slate-500 max-w-md mx-auto">Sync your biometric machine logs with the OPREDEL analytics engine.</p>` (Upload instructions)

### 3. Report Exports & Document Metadata
- **`backend/src/services/report_builder.py`**
  - Line 308: `"prepared_by": "School Attendance Analytics",` (Default PDF generator metadata)
- **`backend/src/services/report_builder_export.py`**
  - Line 54: `pdf.drawString(20, 25, f"Prepared by: {_brand_value(branding, 'prepared_by', 'School Attendance Analytics')}")` (PDF export footer)
- **`backend/src/services/management_report_export.py`**
  - Line 256: `c.drawString(20, 25, f"Printed: {date.today().isoformat()}  |  School Attendance Analytics")` (PDF export page footer)
  - Line 1087: `readme_ws.write("A2", "Generated via School Attendance Analytics Stack", sub_fmt)` (Excel export title sheet)
- **`backend/src/services/report_export.py`**
  - Line 26: `"footer_text": "School Attendance Analytics",` (Config mapping defaults)
  - Line 206: `canvas.drawString(14 * mm, 8 * mm, branding.get("footer_text", "School Attendance Analytics"))` (PDF export footer)
- **`frontend/src/components/report-builder/ReportBuilderPanel.tsx`**
  - Line 125: `prepared_by: "School Attendance Analytics",` (Default form configuration state)

### 4. Backend Main API Title & Docs
- **`backend/src/main.py`**
  - Line 40: `title="School Attendance Analytics",` (Swagger API definition title)
  - Line 92: `return {"status": "ok", "message": "School Attendance Analytics API"}` (API root JSON response)
- **`backend/src/cli.py`**
  - Line 15: `print("Astryx Administrator Provisioning\n")` (CLI admin generator)

### 5. Documentation
- **`README.md`** (Lines 1, 7, 35, 86, 245)
- **`backend/README.md`** (Lines 1, 4)
- **`frontend/README.md`** (Line 1)
- **`PROJECT_CONTEXT.md`** (Lines 3, 11)
- **`MEMORY.md`** (Line 6)
- **`AGENTS.md`** (Line 95)
- **`AUDIT_REPORT.md`** (Line 4)
- **`docs/` subdirectory markdown files** (Includes platform foundation, backup schemes, desktop runbooks, release logs, security audits, CSS/component architectural records).

### 6. Test Assertion Alignments (Proposed Safe)
- **`backend/tests/test_dev_launcher.py`**
  - Lines 141, 155, 174, 228: `assert "No Astryx services were started" in output`
  - Line 228: `assert "Stopping Astryx development stack" in output`
  - *Note: These assertions will fail when we change `start-dev.sh` unless they are updated. We propose renaming these specific string literal checks.*
- **`frontend/src/components/auth/SetupBoundary.test.tsx`**
  - Line 23: `expect(html).toContain("Checking Astryx setup");`
  - *Note: This assertion checks the `SetupBoundary` copy. It must be updated to align with the safe UI change.*

---

## Dangerous Matches (To Be Left Untouched)
Dangerous matches represent database filenames, Cargo targets, Rust imports, environment variables, internal session cookie names, event identifiers, and gated desktop prototype spikes.

### 1. Environment Variable Configurations
- **`backend/src/core/config.py`**
  - Line 38: `ASTRYX_SETUP_TOKEN: str | None = Field(default=None, env="ASTRYX_SETUP_TOKEN")`
- **`backend/src/services/first_admin_provisioning.py`**
  - Lines 42, 47: Config access using `configuration.ASTRYX_SETUP_TOKEN`.
- **`docker-compose.yml`**
  - Line 16: `ASTRYX_SETUP_TOKEN: ${ASTRYX_SETUP_TOKEN:?...}`
- **`backend/tests/test_first_admin_provisioning.py`**
  - Line 34: `ASTRYX_SETUP_TOKEN=token`
- **`.env.example`**
  - Line 15: `ASTRYX_SETUP_TOKEN=`
- **`.github/scripts/check_docker_contract.py`**
  - Line 26: `assert "ASTRYX_SETUP_TOKEN: ${ASTRYX_SETUP_TOKEN:?" in compose`
- **`.github/workflows/ci.yml`**
  - Line 64: `ASTRYX_SETUP_TOKEN: ci-compose-setup-token-not-used-at-runtime`

### 2. Internal Thread, Session, and Security Keys
- **`backend/src/services/backup_scheduler.py`**
  - Line 184: `name="astryx-backup-scheduler"` (Thread name)
- **`backend/src/services/auth_service.py`**
  - Line 17: `_dummy_password_hash` string `"astryx-dummy-password-not-an-account"` (Argon2 dummy hash for secure timing equality checks)
- **`backend/src/security/sessions.py`**
  - Line 16: `SESSION_COOKIE_NAME = "astyx_session"` (Note: spelling is `astyx_session` - pre-existing typo, missing the "r", to be left untouched)
- **`frontend/src/pages/BackupManagement.tsx`**
  - Line 24: `window.sessionStorage.setItem("astryx:login-notice", ...)`
- **`frontend/src/pages/SetupAdmin.tsx`**
  - Line 53: `window.sessionStorage.setItem("astryx:login-notice", ...)`
- **`frontend/src/pages/Login.tsx`**
  - Lines 23, 24: `sessionStorage` references to `"astryx:login-notice"`.
- **`frontend/src/lib/api/client.js`**
  - Line 55: `export const AUTH_UNAUTHORIZED_EVENT = 'astryx:auth-unauthorized';`
- **`frontend/src/pages/BackupManagement.test.tsx`**
  - Line 32: `window.addEventListener("astryx:auth-unauthorized", ...)`

### 3. Gated Tauri / Desktop Spike Implementation
- **`frontend/src-tauri/Cargo.toml`**
  - Lines 2, 8: Cargo package name `astryx-desktop` and library name `astryx_desktop`.
- **`frontend/src-tauri/Cargo.lock`**
  - Multiple references to `astryx-desktop` dependencies and builds.
- **`frontend/src-tauri/src/main.rs`**
  - Line 2: Rust import `astryx_desktop::run();`.
- **`frontend/src-tauri/src/lib.rs`**
  - Line 6: Rust panic check `"failed to run Astryx desktop shell"`.
- **`frontend/src-tauri/capabilities/default.json`**
  - Line 4: JSON description `"Astryx Phase 11 shell with no frontend-accessible native commands."`.
- **`frontend/src-tauri/gen/schemas/capabilities.json`**
  - Automated schema capabilities using internal names.
- **`desktop-spike/backend_entry.py`**
  - Line 15: `APP_NAME = "Astryx"`
  - Line 44: `"Another Astryx sidecar already owns this application data root"`
  - Line 72: `ASTRYX_DATA_ROOT`
  - Line 113: `database = root / "data" / "astryx.sqlite3"`
  - Line 130: `description="Experimental Astryx FastAPI sidecar"`
- **`desktop-spike/build-nuitka.ps1`**
  - Lines 4, 8: `astryx-nuitka-spike` temp pathing and `AstryxBackend.exe` target output names.
- **`desktop-spike/spec/astryx_backend.spec`**
  - Line 29: `name="AstryxBackend"`
- **`desktop-spike/supervisor.py`**
  - Gated lifecycles binding to `AstryxBackend.exe` and `ASTRYX_DATA_ROOT`.
- **`desktop-spike/build-pyinstaller.ps1`**
  - PyInstaller configuration targeting `AstryxBackend.exe`.
- **`desktop-spike/README.md`**
  - Gated descriptions referencing `AstryxSpike` and `%LOCALAPPDATA%\Astryx`.
- **`tests/desktop/` tests harness**
  - References `Astryx`, `AstryxBackend.exe`, `ASTRYX_DATA_ROOT`, and `astryx.sqlite3`.
- **`docs/tauri/` and `docs/desktop/` directories (specific local filesystem pathing)**
  - References to `%LOCALAPPDATA%/Astryx` and `astryx.sqlite3` are classified as dangerous/untouched. While comments/text inside these docs are safe to rename, references specifying literal paths or application data directories are untouched to match the actual app configuration.

---

## Detailed Scopes Checked

### 1. ReportLab PDF Export
The analytics export service uses ReportLab to render PDFs:
- **`backend/src/services/management_report_export.py`**: Exports PDF for management summary. Footers contain `"School Attendance Analytics"`. Checked and classified as **safe** for replacement in Phase 1.
- **`backend/src/services/report_export.py`**: Footers write `"School Attendance Analytics"`. Classified as **safe**.
- **`backend/src/services/report_builder_export.py`**: Uses `"School Attendance Analytics"` if branding configuration has no override. Classified as **safe**.

### 2. XlsxWriter Excel Export
- **`backend/src/services/management_report_export.py`**: Line 1087 writes `"Generated via School Attendance Analytics Stack"` on the README/Cover sheet. Checked and classified as **safe**.

### 3. Frontend Titles & Banners
- **`<title>` tag**: Defined in `frontend/index.html` and `frontend/public/index.html` as `School Attendance Analytics | OPREDEL`. Checked and classified as **safe**.
- **Sidebar Header Asset**: The current sidebar uses `<span className="font-bold text-xl tracking-tight text-slate-800">OPREDEL</span>` and a generic letter logo `"A"`. These will be safely updated in Phase 1.

---

## Gated Future Metadata Notes (For Phase 2)
For future reference when Phase 11 desktop work resumes, the following Tauri properties in `frontend/src-tauri/tauri.conf.json` must be updated:
- **Product Name**: `"productName": "Astryx"` &rarr; `"productName": "OperatorOS"`
- **Window Title**: `"title": "Astryx"` &rarr; `"title": "OperatorOS"`
- **Tauri Bundle Identifier**: `"identifier": "com.edelweiss.astrx"` &rarr; `"identifier": "com.edelweiss.operatoros"` (or similar bundle ID suffix).
- **Cargo Package Metadata**: Cargo `name` and description in `frontend/src-tauri/Cargo.toml` will be updated to align with the new branding.

# Desktop Dependency Review

## Frontend

| Group | Classification | Action |
| --- | --- | --- |
| React/DOM/Router | Compatible with review | Prove BrowserRouter deep refresh or use loopback hosting. |
| Vite, Tailwind, PostCSS, Autoprefixer | Compatible | Build-time only; ship local compiled assets. |
| TanStack Query/Table | Compatible | Verify cache reset after restore/restart. |
| Radix, CVA, clsx, tailwind-merge, Lucide | Compatible | Verify portals, focus, keyboard, WebView rendering. |
| Chart.js wrappers | Compatible with review | Test GPU fallback, resize, printing, performance. |
| Framer Motion | Compatible with review | Test performance and reduced motion. |
| Blob/file/clipboard/print built-ins | Requires review | Native-dialog/capability decisions are in the runtime audit. |

No notification/download/filesystem library, service worker, remote CDN, or extension dependency was found.

## Backend

| Dependency | Classification | Packaging concern |
| --- | --- | --- |
| FastAPI, Pydantic, SQLAlchemy, Uvicorn | Compatible sidecar | Include runtime metadata; one worker, no reload. |
| pandas/NumPy | High review | Native binaries/data and size/startup; exercise every Excel path. |
| openpyxl, xlrd, XlsxWriter | Review | Test all XLS/XLSX imports/exports. |
| ReportLab | Review | Include fonts/resources; compare every PDF. |
| argon2-cffi | High review | Native binding must load on clean Windows and preserve hashes. |
| python-multipart | Compatible with tests | Verify upload/temp-file behavior. |
| asyncpg | Optional desktop | Server PostgreSQL only; decide universal vs separate build. |
| python-dotenv | Review | Desktop uses launcher-owned configuration, not cwd `.env`. |
| pytest/httpx | Development only | Exclude from production bundle. |

Run clean Windows x86_64 PyInstaller and Nuitka spikes. Compare reproducibility, cold start, size, antivirus, hidden imports, native libraries, resources, diagnostics, and signing. Acceptance covers migrations, Argon2, Excel, every PDF, WAL, backups, restore/restart, and update/uninstall data preservation. Users must not install Python.

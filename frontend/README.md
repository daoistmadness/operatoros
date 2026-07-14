# School Attendance Analytics Frontend

## Responsibilities
This React app provides the staff-facing UI for uploading attendance files, mapping students to classes, configuring HEB and jenjang rules, reviewing attendance overrides, and viewing reports and charts.

## Structure
```text
frontend/
├── src/
│   ├── components/   # Shared UI and navigation
│   ├── lib/          # API client and helpers
│   ├── pages/        # Route-level screens
│   ├── App.js        # Router definition
│   ├── index.js
│   ├── index.css     # Tailwind source
│   └── tailwind.css  # Generated stylesheet imported by the app
├── public/
├── package.json
├── Dockerfile
└── nginx.conf
```

## Requirements
- Node.js 22+
- npm

## Setup
```bash
cd frontend
npm ci
```

## Run
### Direct local development
```bash
npm run dev
```

### Repository launcher
Run the repo launcher from the root:
```bash
./start-dev.sh
```

The launcher starts Vite and FastAPI directly. Vite proxies canonical `/api/*` browser requests to the backend.

## Production Build
```bash
npm run build
```

The production bundle is served from `frontend/build/`.

## API Configuration
- [`src/lib/api/client.js`](src/lib/api/client.js) centralizes URL building.
- `VITE_API_BASE_URL` is the only build-time browser API base variable.
- The default empty value keeps requests same-origin; Vite proxies them in development and Nginx proxies them in Compose.
- The client sends JSON requests, multipart uploads, and file downloads through the shared request helper in `frontend/src/lib/api/`.
- Authentication uses the backend's HttpOnly session cookie rather than browser-stored bearer tokens.

## Routes and Pages
Routes are defined in [`src/App.js`](src/App.js):
- `/` Dashboard
- `/upload` Upload file import screen
- `/upload-history` Latest upload attempts
- `/mapping` Class mapping
- `/attendance-review` Manual attendance override review
- `/config/jenjang` Jenjang cutoff configuration
- `/config/heb` HEB overrides
- `/config/absence-reasons` Sakit / Izin / Alfa entry
- `/reports` Attendance report builder
- `/reports/rekap-absensi` Rekap absensi report
- `/reports/tardiness` Tardiness report
- `/settings` System reset and settings
- `/students/:id` Student profile

The `Settings` page hides destructive reset controls unless the backend explicitly reports that destructive operations are enabled.

## Docker and Nginx
- [`Dockerfile`](Dockerfile) builds the React app and serves it with Nginx.
- The image accepts only the Vite build argument `VITE_API_BASE_URL`; Compose leaves it empty for same-origin requests.
- [`nginx.conf`](nginx.conf) serves the SPA shell and proxies `/api/*` to the backend container.
- `location ^~ /api/` preserves the canonical `/api` prefix when proxying to `http://backend:8000`.
- `client_max_body_size` is set high enough for workbook uploads, and the SPA fallback keeps client-side routes working.

## Verification
```bash
npm run build
```

If the build fails, check:
- `VITE_API_BASE_URL`
- the Vite proxy target in `vite.config.js`
- backend availability
- CORS settings on the API for direct-port development
- stale `node_modules/`

## Troubleshooting
- If the frontend cannot reach the API, confirm the Vite development proxy target and backend port.
- If the browser shows React HTML instead of JSON, confirm that the request path starts with `/api` exactly once.
- If uploads fail, verify that the workbook is `.xlsx` and that the backend sample template matches the source file.
- If browser verification fails, install Agent Browser with `npm install -g agent-browser` and `agent-browser install` (or `agent-browser install --with-deps` on Linux/WSL2).

## Known Limitations
- Frontend tests run with Vitest.
- The UI assumes the backend routes documented in the source code are available.
- Some screens depend on class mapping and HEB data being populated first.

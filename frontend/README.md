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
- Node.js 22+ for direct `npm start` and `npm run build`
- Node.js 24+ if you use the Portless-first launcher in [`start-dev.sh`](../start-dev.sh)
- npm

## Setup
```bash
cd frontend
npm ci
```

## Run
### Direct local development
```bash
REACT_APP_API_URL=http://localhost:8000 npm start
```

### Portless-first development
Run the repo launcher from the root:
```bash
./start-dev.sh
```

The launcher sets `REACT_APP_API_URL=/api` and `DEV_API_PROXY_TARGET` so browser requests stay same-origin while CRA proxies them to the backend URL.

## Production Build
```bash
npm run build
```

The production bundle is served from `frontend/build/`.

## API Configuration
- [`src/lib/api/client.js`](src/lib/api/client.js) centralizes URL building.
- `REACT_APP_API_URL` controls the browser-facing API base.
- `DEV_API_PROXY_TARGET` is the dev-server-only proxy target used by [`src/setupProxy.js`](src/setupProxy.js).
- Local direct development uses `http://localhost:8000`.
- Portless and Docker use `/api` so browser requests remain same-origin.
- The client sends JSON requests, multipart uploads, and file downloads through the shared request helper in `frontend/src/lib/api/`.
- The client checks `localStorage` for `access_token`, `token`, or `authToken`, but the backend does not currently expose an auth system.

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
- [`nginx.conf`](nginx.conf) serves the SPA shell and proxies `/api/*` to the backend container.
- `location ^~ /api/` strips the `/api` prefix before proxying to `http://backend:8000/`.
- `client_max_body_size` is set high enough for workbook uploads, and the SPA fallback keeps client-side routes working.

## Verification
```bash
npm run build
```

If the build fails, check:
- `REACT_APP_API_URL`
- `DEV_API_PROXY_TARGET` when using the development proxy
- backend availability
- CORS settings on the API for direct-port development
- stale `node_modules/`

## Troubleshooting
- If the frontend cannot reach the API in Portless mode, confirm `DEV_API_PROXY_TARGET` and `portless trust`.
- If the browser shows React HTML instead of JSON, confirm that the request path starts with `/api` exactly once.
- If uploads fail, verify that the workbook is `.xlsx` and that the backend sample template matches the source file.
- If browser verification fails, install Agent Browser with `npm install -g agent-browser` and `agent-browser install` (or `agent-browser install --with-deps` on Linux/WSL2).

## Known Limitations
- There is no dedicated frontend test suite in the repo beyond the CRA test runner.
- The UI assumes the backend routes documented in the source code are available.
- Some screens depend on class mapping and HEB data being populated first.

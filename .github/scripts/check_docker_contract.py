"""Fail CI when the supported Docker configuration drifts from application contracts."""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def read(relative_path: str) -> str:
    return (ROOT / relative_path).read_text(encoding="utf-8")


compose = read("docker-compose.yml")
frontend_dockerfile = read("frontend/Dockerfile")
backend_dockerfile = read("backend/Dockerfile")
client = read("frontend/src/lib/api/client.js")
nginx = read("frontend/nginx.conf")

assert "ARG VITE_API_BASE_URL=" in frontend_dockerfile
assert "ENV VITE_API_BASE_URL=$VITE_API_BASE_URL" in frontend_dockerfile
assert "REACT_APP_API_URL" not in frontend_dockerfile
assert "VITE_API_BASE_URL: ${VITE_API_BASE_URL:-}" in compose
assert "import.meta.env.VITE_API_BASE_URL" in client

assert "AUTH_COOKIE_SECRET: ${AUTH_COOKIE_SECRET:?" in compose
assert "ASTRYX_SETUP_TOKEN: ${ASTRYX_SETUP_TOKEN:?" in compose
assert "POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?" in compose
assert "AUTH_COOKIE_SECRET=" not in backend_dockerfile

assert "proxy_pass http://backend:8000;" in nginx
assert "proxy_pass http://backend:8000/;" not in nginx
assert 'ENV BACKEND_WORKERS=1' in backend_dockerfile
assert '"--workers", "1"' in backend_dockerfile
assert 'BACKEND_WORKERS: "1"' in compose

assert "condition: service_healthy" in compose
assert "/docker-entrypoint-initdb.d/10-identity-schema.sql:ro" in compose
assert "/docker-entrypoint-initdb.d/20-backup-scheduler.sql:ro" in compose
assert "/docker-entrypoint-initdb.d/30-first-admin-setup.sql:ro" in compose
assert "backend_data:/app/data" in compose
assert "db_data:/var/lib/postgresql/data" in compose

print("Docker configuration contract is aligned.")

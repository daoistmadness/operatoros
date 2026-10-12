#!/usr/bin/env bash
set -Eeuo pipefail

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
image=localhost/operatoros-dev:worktree
host=oprserver.taile856.ts.net
suffix="$(date +%s)-$$"
pod="operatoros-dev-smoke-$suffix"
modules="operatoros-dev-smoke-modules-$suffix"
api="operatoros-dev-smoke-api-$suffix"
web="operatoros-dev-smoke-web-$suffix"
temp="$(mktemp -d)"
data="$temp/data"

logs() {
  podman logs --tail=60 "$1" 2>&1 | sed -E \
    -e 's/((AUTH_COOKIE_SECRET|BACKUP_ENCRYPTION_KEY|ASTRYX_SETUP_TOKEN|DATABASE_URL|DATABASE_PATH)=)[^[:space:]]+/\1[REDACTED]/g' \
    -e 's/(Bearer )[A-Za-z0-9._~+\/-]+=*/\1[REDACTED]/g' | tee -a "${OPERATOROS_DIAGNOSTICS_FILE:-/dev/null}"
}
cleanup() {
  status=$?
  trap - EXIT
  set +e
  podman pod rm -f --ignore "$pod" >/dev/null
  [ "$?" -eq 0 ] || status=1
  if podman volume exists "$modules"; then podman volume rm "$modules" >/dev/null; [ "$?" -eq 0 ] || status=1; fi
  podman unshare chown -R 0:0 "$temp" >/dev/null 2>&1
  [ "$?" -eq 0 ] || status=1
  rm -rf -- "$temp"
  [ "$?" -eq 0 ] || status=1
  exit "$status"
}
trap cleanup EXIT

command -v podman >/dev/null || { echo 'Podman is required.' >&2; exit 1; }
test "$(podman info --format '{{.Host.Security.Rootless}}')" = true || { echo 'Podman must run rootless.' >&2; exit 1; }
podman image exists "$image" || { echo 'Build with mise run podman:build first.' >&2; exit 1; }
command -v tailscale >/dev/null || { echo 'Tailscale CLI unavailable; live HMR is blocked.' >&2; exit 2; }
serve_status="$(tailscale serve status 2>/dev/null)" || { echo 'Tailscale Serve unavailable; live HMR is blocked.' >&2; exit 2; }
printf '%s\n' "$serve_status" | grep -Fq "https://$host:8444" || { echo 'Approved Tailscale HTTPS endpoint is not configured.' >&2; exit 2; }
printf '%s\n' "$serve_status" | grep -Fq '127.0.0.1:5173' || { echo 'Tailscale Serve does not target 127.0.0.1:5173.' >&2; exit 2; }
tailscale_ip="$(tailscale ip -4 | head -n1)"
test -n "$tailscale_ip" || { echo 'Tailscale IPv4 address unavailable.' >&2; exit 2; }
if ss -H -ltn 'sport = :5173' | grep -q .; then echo 'Port 5173 is occupied; no process was stopped.' >&2; exit 1; fi

mkdir "$data"
podman pod create --name "$pod" --network slirp4netns --publish 127.0.0.1:5173:5173 \
  --label io.operatoros.owner=smoke --exit-policy stop >/dev/null
podman volume create --label io.operatoros.owner=smoke "$modules" >/dev/null
podman run -d --name "$api" --pod "$pod" \
  -v "$root:/workspace/operatoros:ro" -v "$modules:/workspace/operatoros/node_modules:U" \
  -v "$data:/var/lib/operatoros:U" \
  -e HOST=0.0.0.0 -e PORT=8090 -e NODE_ENV=development -e OPERATOROS_DATA_DIR=/var/lib/operatoros \
  -e AUTH_COOKIE_SECRET=podman-development-smoke-secret-at-least-thirty-two-chars \
  -e "ALLOWED_ORIGINS=https://$host:8444,http://localhost:5173,http://127.0.0.1:5173" \
  "$image" /usr/local/bin/operatoros-dev-entrypoint api >/dev/null
podman run -d --name "$web" --pod "$pod" -v "$root:/workspace/operatoros:ro" \
  -v "$modules:/workspace/operatoros/node_modules:U" \
  -e FRONTEND_HOST=0.0.0.0 -e FRONTEND_PORT=5173 -e BACKEND_PORT=8090 \
  -e DEV_API_PROXY_TARGET=http://127.0.0.1:8090 -e OPERATOROS_DISABLE_ENV_FILES=true \
  -e VITE_HMR_HOST="$host" -e VITE_HMR_PROTOCOL=wss -e VITE_HMR_CLIENT_PORT=8444 \
  "$image" /usr/local/bin/operatoros-dev-entrypoint web >/dev/null

ready=0
for _ in $(seq 1 45); do
  if curl --fail --silent http://127.0.0.1:5173/ >/dev/null \
    && curl --fail --silent http://127.0.0.1:5173/api/system/health | rg -q '"service":"System API"'; then
    ready=1
    break
  fi
  if [ "$(podman inspect -f '{{.State.Running}}' "$api")" != true ] || [ "$(podman inspect -f '{{.State.Running}}' "$web")" != true ]; then break; fi
  sleep 1
done
if [ "$ready" != 1 ]; then logs "$api"; logs "$web"; echo 'Development API/Vite readiness failed.' >&2; exit 1; fi
infra_id="$(podman pod inspect --format '{{.InfraContainerID}}' "$pod")"
test "$(podman port "$infra_id" 5173/tcp)" = '127.0.0.1:5173'
unknown_host="$(curl --max-time 3 --silent --output /dev/null --write-out '%{http_code}' -H 'Host: unapproved.invalid' http://127.0.0.1:5173/)"
test "$unknown_host" = 403 || { echo "Expected Vite to reject an unknown host, got $unknown_host." >&2; exit 1; }
curl --noproxy '*' --fail --silent --show-error --resolve "$host:8444:$tailscale_ip" "https://$host:8444/" | rg -qi '<!doctype html>|<!DOCTYPE html>'
curl --noproxy '*' --fail --silent --show-error --resolve "$host:8444:$tailscale_ip" "https://$host:8444/api/system/health" | rg -q '"service":"System API"'
test "$(podman inspect -f '{{.Config.User}}' "$api")" = bun
test "$(podman inspect -f '{{.Config.User}}' "$web")" = bun
podman exec "$api" bun --no-env-file packages/db/src/dev-db-cli.ts status --repo . --data-dir /var/lib/operatoros --expected-schema 20261002_s48

set +e
client_js="$(curl --fail --silent --show-error http://127.0.0.1:5173/@vite/client)"
ws_token="$(printf '%s' "$client_js" | sed -n 's/.*const wsToken = "\([^"]*\)";.*/\1/p' | head -n1)"
test -n "$ws_token" || { echo 'Vite client did not expose its runtime WebSocket token.' >&2; logs "$web"; exit 1; }
if ! grep -Fq 'const socketProtocol = "wss"' <<<"$client_js" \
  || ! grep -Fq "\"$host\"" <<<"$client_js" \
  || ! grep -Fq 'const hmrPort = 8444;' <<<"$client_js"; then
  echo 'Vite client is not configured for the approved external WSS endpoint.' >&2
  printf '%s\n' "$client_js" | sed -E 's/(const wsToken = )"[^"]*"/\1"[REDACTED]"/' | grep -E 'socketProtocol|socketHost|hmrPort|wsToken' | head -5
  exit 1
fi
local_ws="$(curl --silent --show-error --include --http1.1 --max-time 3 \
  -H "Host: $host:8444" -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' \
  -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' -H 'Sec-WebSocket-Protocol: vite-hmr' \
  -H "Origin: https://$host:8444" "http://127.0.0.1:5173/?token=$ws_token" 2>&1)"
local_ws_status=$?
set -e
if [ "$local_ws_status" -ne 0 ] && [ "$local_ws_status" -ne 28 ]; then printf '%s\n' "$local_ws"; logs "$web"; exit "$local_ws_status"; fi
printf '%s' "$local_ws" | grep -qi '101 Switching Protocols' || { echo 'Local Vite WebSocket upgrade failed.' >&2; printf '%s\n' "$local_ws"; logs "$web"; exit 1; }

set +e
ws="$(curl --noproxy '*' --silent --show-error --include --http1.1 --max-time 3 --resolve "$host:8444:$tailscale_ip" \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' \
  -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' -H 'Sec-WebSocket-Protocol: vite-hmr' \
  -H "Origin: https://$host:8444" "https://$host:8444/?token=$ws_token" 2>&1)"
ws_status=$?
set -e
if [ "$ws_status" -ne 0 ] && [ "$ws_status" -ne 28 ]; then printf '%s\n' "$ws"; exit "$ws_status"; fi
printf '%s' "$ws" | grep -qi '101 Switching Protocols' || { echo 'Tailscale WSS upgrade failed after the direct Vite upgrade passed.' >&2; printf '%s\n' "$ws"; logs "$web"; exit 1; }

podman stop --time 10 "$web" "$api" >/dev/null
set +e
ping_during_restart="$(curl --noproxy '*' --silent --include --http1.1 --max-time 3 --resolve "$host:8444:$tailscale_ip" \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' \
  -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' -H 'Sec-WebSocket-Protocol: vite-ping' \
  -H "Origin: https://$host:8444" "https://$host:8444/" 2>&1)"
ping_during_restart_rc=$?
set -e
if [ "$ping_during_restart_rc" -ne 0 ] && [ "$ping_during_restart_rc" -ne 28 ]; then printf '%s\n' "$ping_during_restart"; exit "$ping_during_restart_rc"; fi
printf '%s' "$ping_during_restart" | grep -qi '101 Switching Protocols' && { echo 'Vite remained pingable while its containers were stopped.' >&2; exit 1; }
podman start "$api" >/dev/null
for _ in $(seq 1 30); do
  if podman exec "$api" /usr/local/bin/operatoros-dev-healthcheck api; then break; fi
  sleep 1
done
podman start "$web" >/dev/null
for _ in $(seq 1 30); do
  if curl --noproxy '*' --fail --silent --resolve "$host:8444:$tailscale_ip" "https://$host:8444/" >/dev/null; then break; fi
  sleep 1
done
curl --noproxy '*' --fail --silent --show-error --resolve "$host:8444:$tailscale_ip" "https://$host:8444/api/system/health" | rg -q '"service":"System API"'
set +e
ping_after_restart="$(curl --noproxy '*' --silent --include --http1.1 --max-time 3 --resolve "$host:8444:$tailscale_ip" \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' \
  -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' -H 'Sec-WebSocket-Protocol: vite-ping' \
  -H "Origin: https://$host:8444" "https://$host:8444/" 2>&1)"
ping_after_restart_rc=$?
set -e
if [ "$ping_after_restart_rc" -ne 0 ] && [ "$ping_after_restart_rc" -ne 28 ]; then printf '%s\n' "$ping_after_restart"; exit "$ping_after_restart_rc"; fi
printf '%s' "$ping_after_restart" | grep -qi '101 Switching Protocols' || { echo 'Vite HMR restart ping did not recover after container restart.' >&2; printf '%s\n' "$ping_after_restart"; logs "$web"; exit 1; }
echo 'PASS: rootless dev containers, loopback-only publication, tailnet HTTPS/WSS, API proxy, host rejection, Vite restart ping, disposable S4.8 data'

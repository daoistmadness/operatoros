#!/usr/bin/env bash
set -Eeuo pipefail

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
suffix="$(date +%s)-$$"
image=localhost/operatoros-dev:worktree
port_a="${OPERATOROS_DEV_SMOKE_PORT:-15173}"
temp="$(mktemp -d)"
pod_a="operatoros-dev-isolated-a-$suffix"
pod_b="operatoros-dev-isolated-b-$suffix"
created_pods=()

fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
logs() {
  podman logs --tail=60 "$1" 2>&1 | sed -E \
    -e 's/((AUTH_COOKIE_SECRET|BACKUP_ENCRYPTION_KEY|ASTRYX_SETUP_TOKEN|DATABASE_URL|DATABASE_PATH)=)[^[:space:]]+/\1[REDACTED]/g' \
    -e 's/(Bearer )[A-Za-z0-9._~+\/-]+=*/\1[REDACTED]/g'
}
cleanup() {
  local status=$? pod cleanup_failed=0
  trap - EXIT
  set +e
  for pod in "${created_pods[@]}"; do
    podman pod rm --force --time 2 "$pod" >/dev/null || cleanup_failed=1
  done
  if [[ "$cleanup_failed" == 0 ]]; then
    rm -rf -- "$temp" || status=1
  else
    printf 'WARN: temporary bind mounts were preserved at %s because an owned test pod could not be removed\n' "$temp" >&2
    status=1
  fi
  exit "$status"
}
trap cleanup EXIT

command -v podman >/dev/null || fail 'Podman is required'
command -v curl >/dev/null || fail 'curl is required'
command -v ss >/dev/null || fail 'ss is required to verify isolated ports'
[[ "$(podman info --format '{{.Host.Security.Rootless}}')" == true ]] || fail 'Podman must be rootless'
[[ "$port_a" =~ ^[0-9]{4,5}$ && "$port_a" -ge 1024 ]] || fail 'test ports must be valid unprivileged TCP ports'
port_b=$((10#$port_a + 1))
[[ "$port_b" -le 65535 ]] || fail 'second test port exceeds the valid TCP range'
for port in "$port_a" "$port_b"; do
  if ss -H -ltn "sport = :$port" | grep -q .; then fail "loopback port $port is occupied; no process was stopped"; fi
done

mkdir -p "$temp/selected" "$temp/primary" "$temp/second" "$temp/data-a" "$temp/data-b" "$temp/deps-a" "$temp/deps-b"
# Simulate the prior lock-only marker so startup must refresh the dependency volume for hoisted-v1.
sha256sum "$root/bun.lock" | cut -d ' ' -f 1 > "$temp/deps-a/.operatoros-image-lock"
for checkout in selected primary second; do
  git clone --quiet --shared --no-checkout "$root" "$temp/$checkout"
  git -C "$temp/$checkout" checkout --quiet HEAD
done
git -C "$temp/selected" switch --quiet -c codex/selected-dev
git -C "$temp/second" switch --quiet -c codex/second-worktree
git -C "$temp/primary" switch --quiet -c codex/primary-before
git -C "$temp/primary" switch --quiet -c codex/primary-after

bash "$root/scripts/podman-ci.sh" build

mkdir -p "$temp/contaminated"
git clone --quiet --shared --no-checkout "$root" "$temp/contaminated/source"
git -C "$temp/contaminated/source" checkout --quiet HEAD
mkdir -p "$temp/contaminated/source/packages/db/node_modules"
if podman run --rm --userns=keep-id --network=none \
  --volume "$temp/contaminated/source:/workspace/operatoros:ro" \
  --volume "$temp/deps-a:/workspace/operatoros/node_modules" \
  "$image" /usr/local/bin/operatoros-dev-entrypoint api >"$temp/contaminated-entrypoint.log" 2>&1; then
  fail 'container entrypoint accepted host-generated workspace dependencies'
fi
grep -Fq 'Host-generated workspace dependencies exist at packages/db/node_modules' "$temp/contaminated-entrypoint.log" \
  || fail 'container entrypoint did not identify host-generated workspace dependencies'

podman pod create --name "$pod_a" --userns=keep-id --network slirp4netns --publish "127.0.0.1:$port_a:5173" --label io.operatoros.owner=isolated-smoke >/dev/null
created_pods+=("$pod_a")
podman pod create --name "$pod_b" --userns=keep-id --network slirp4netns --publish "127.0.0.1:$port_b:5173" --label io.operatoros.owner=isolated-smoke >/dev/null
created_pods+=("$pod_b")

start_instance() {
  local letter="$1" checkout="$2" port="$3" data="$temp/data-$1" deps="$temp/deps-$1" pod="$pod_a"
  [[ "$letter" == b ]] && pod="$pod_b"
  podman run -d --name "operatoros-dev-isolated-api-$letter-$suffix" --pod "$pod" \
    --volume "$checkout:/workspace/operatoros:ro" --volume "$deps:/workspace/operatoros/node_modules" \
    --volume "$data:/var/lib/operatoros-dev" \
    --env HOST=0.0.0.0 --env PORT=8090 --env NODE_ENV=development \
    --env OPERATOROS_DATA_DIR=/var/lib/operatoros-dev \
    --env OPERATOROS_DEV_BOOTSTRAP=true \
    --env AUTH_COOKIE_SECRET=operatoros-isolated-smoke-secret-0123456789abcdef \
    --env COOKIE_SECURE=false \
    --env "ALLOWED_ORIGINS=http://localhost:$port,http://127.0.0.1:$port" \
    --health-cmd '/usr/local/bin/operatoros-dev-healthcheck api' --health-interval=2s --health-timeout=3s --health-start-period=15s --health-retries=3 \
    "$image" /usr/local/bin/operatoros-dev-entrypoint api >/dev/null
  podman run -d --name "operatoros-dev-isolated-web-$letter-$suffix" --pod "$pod" \
    --volume "$checkout:/workspace/operatoros:ro" --volume "$deps:/workspace/operatoros/node_modules" \
    --env FRONTEND_HOST=0.0.0.0 --env FRONTEND_PORT=5173 --env BACKEND_PORT=8090 \
    --env DEV_API_PROXY_TARGET=http://127.0.0.1:8090 --env OPERATOROS_DISABLE_ENV_FILES=true \
    --env VITE_HMR_HOST=localhost --env VITE_HMR_PROTOCOL=ws --env "VITE_HMR_CLIENT_PORT=$port" \
    --health-cmd '/usr/local/bin/operatoros-dev-healthcheck web' --health-interval=2s --health-timeout=3s --health-start-period=15s --health-retries=3 \
    "$image" /usr/local/bin/operatoros-dev-entrypoint web >/dev/null
}

start_instance a "$temp/selected" "$port_a"
start_instance b "$temp/second" "$port_b"

wait_ready() {
  local port="$1" api="operatoros-dev-isolated-api-$2-$suffix" web="operatoros-dev-isolated-web-$2-$suffix" attempt
  for attempt in $(seq 1 60); do
    if curl --fail --silent "http://127.0.0.1:$port/" >/dev/null \
      && curl --fail --silent "http://127.0.0.1:$port/api/system/health" | grep -q '"service":"System API"'; then
      [[ "$(podman inspect -f '{{.State.Health.Status}}' "$api")" == healthy ]] || { sleep 1; continue; }
      [[ "$(podman inspect -f '{{.State.Health.Status}}' "$web")" == healthy ]] || { sleep 1; continue; }
      return 0
    fi
    local api_running web_running
    if ! api_running="$(podman inspect -f '{{.State.Running}}' "$api" 2>/dev/null)" \
      || ! web_running="$(podman inspect -f '{{.State.Running}}' "$web" 2>/dev/null)"; then
      logs "$api"; logs "$web"; return 1
    fi
    if [[ "$api_running" != true || "$web_running" != true ]]; then
      logs "$api"; logs "$web"; return 1
    fi
    sleep 1
  done
  logs "$api"; logs "$web"; return 1
}

wait_ready "$port_a" a || fail 'selected checkout did not serve frontend and proxied API'
wait_ready "$port_b" b || fail 'second isolated worktree did not serve frontend and proxied API'
git -C "$temp/primary" switch --quiet codex/primary-before
git -C "$temp/primary" switch --quiet codex/primary-after
wait_ready "$port_a" a || fail 'selected service changed when the unrelated primary checkout branch changed'

for tuple in "a:$port_a" "b:$port_b"; do
  letter="${tuple%%:*}"; port="${tuple#*:}"
  unknown="$(curl --max-time 3 --silent --output /dev/null --write-out '%{http_code}' -H 'Host: unapproved.invalid' "http://127.0.0.1:$port/")"
  [[ "$unknown" == 403 ]] || fail "Vite accepted an unapproved Host for worktree $letter (HTTP $unknown)"
  api="operatoros-dev-isolated-api-$letter-$suffix"
  podman exec "$api" bun --no-env-file packages/db/src/dev-db-cli.ts status --repo . --data-dir /var/lib/operatoros-dev --expected-schema 20261002_s48
  [[ "$(podman inspect -f '{{.Config.User}}' "$api")" == bun ]] || fail "API $letter did not run as the image's non-root user"
done
[[ "$(stat -c '%d:%i' "$temp/data-a/operatoros.sqlite")" != "$(stat -c '%d:%i' "$temp/data-b/operatoros.sqlite")" ]] || fail 'synthetic worktrees unexpectedly share one SQLite file'

podman stop --time 10 "operatoros-dev-isolated-web-a-$suffix" "operatoros-dev-isolated-api-a-$suffix" \
  "operatoros-dev-isolated-web-b-$suffix" "operatoros-dev-isolated-api-b-$suffix" >/dev/null
podman start "operatoros-dev-isolated-api-a-$suffix" "operatoros-dev-isolated-web-a-$suffix" \
  "operatoros-dev-isolated-api-b-$suffix" "operatoros-dev-isolated-web-b-$suffix" >/dev/null
wait_ready "$port_a" a || fail 'first synthetic worktree did not recover after restart'
wait_ready "$port_b" b || fail 'second synthetic worktree did not recover after restart'

printf 'PASS: rootless temporary worktrees use isolated S4.8 data and ports %s/%s; host dependency shadowing is rejected; primary branch changes do not redirect selected checkout; API proxy, unknown-host rejection and restart pass\n' "$port_a" "$port_b"

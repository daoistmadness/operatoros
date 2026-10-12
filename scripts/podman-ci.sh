#!/usr/bin/env bash
set -Eeuo pipefail

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
command -v podman >/dev/null || { echo 'Podman is required.' >&2; exit 1; }
image_tag="${OPERATOROS_IMAGE_TAG:-worktree}"
api="localhost/operatoros-api:$image_tag"
web="localhost/operatoros-web:$image_tag"
dev="localhost/operatoros-dev:worktree"
revision="$(git rev-parse HEAD)"

sanitized_logs() {
  podman logs --tail=60 "$1" 2>&1 | sed -E \
    -e 's/((AUTH_COOKIE_SECRET|BACKUP_ENCRYPTION_KEY|ASTRYX_SETUP_TOKEN|DATABASE_URL|DATABASE_PATH)=)[^[:space:]]+/\1[REDACTED]/g' \
    -e 's/(Bearer )[A-Za-z0-9._~+\/-]+=*/\1[REDACTED]/g' | tee -a "${OPERATOROS_DIAGNOSTICS_FILE:-/dev/null}"
}

case "${1:-}" in
  doctor)
    podman info --format 'Podman={{.Version.Version}} rootless={{.Host.Security.Rootless}} storage={{.Store.GraphDriverName}} cgroups={{.Host.CgroupsVersion}}'
    podman version --format 'Podman client={{.Client.Version}}'
    test "$(podman info --format '{{.Host.Security.Rootless}}')" = true || { echo 'Podman must run rootless.' >&2; exit 1; }
    ;;
  build)
    podman build --format oci --timestamp 0 --build-arg "VCS_REF=$revision" -f containers/Containerfile --target api -t "$api" .
    podman build --format oci --timestamp 0 --build-arg "VCS_REF=$revision" -f containers/Containerfile --target web -t "$web" .
    podman build --format oci --timestamp 0 --build-arg "VCS_REF=$revision" -f containers/Containerfile --target development -t "$dev" .
    podman image inspect "$api" "$web" --format '{{.RepoTags}} {{.Digest}}'
    ;;
  smoke)
    podman image exists "$api" && podman image exists "$web" || { echo 'Build both images first.' >&2; exit 1; }
    suffix="$$"
    api_name="operatoros-api-smoke-$suffix"
    web_name="operatoros-web-smoke-$suffix"
    temp="$(mktemp -d)"
    data="$temp/data"
    mkdir "$data"
    expected_schema="$(bun packages/db/src/schema-version-cli.ts --format current)"
    [ "$expected_schema" = 20261002_s48 ] || { echo "Expected canonical S4.8 schema, got $expected_schema" >&2; exit 1; }
    sed -e 's/operatoros-api:8090/127.0.0.1:8090/g' \
      containers/nginx.conf > "$temp/nginx.conf"
    cleanup() {
      status=$?
      trap - EXIT
      set +e
      podman rm -f --ignore "$web_name" >/dev/null
      [ "$?" -eq 0 ] || status=1
      podman rm -f --ignore "$api_name" >/dev/null
      [ "$?" -eq 0 ] || status=1
      podman unshare chown -R 0:0 "$temp" >/dev/null 2>&1
      [ "$?" -eq 0 ] || status=1
      rm -rf -- "$temp"
      [ "$?" -eq 0 ] || status=1
      exit "$status"
    }
    trap cleanup EXIT
    OPERATOROS_DATA_DIR="$data" bun run db:bootstrap --data-dir "$data"
    podman run -d --name "$api_name" --network=none \
      -e HOST=0.0.0.0 -e PORT=8090 -e OPERATOROS_DATA_DIR=/var/lib/operatoros \
      -e AUTH_COOKIE_SECRET=ci-smoke-secret-with-more-than-thirty-two-characters -e NODE_ENV=test \
      --health-cmd /usr/local/bin/operatoros-healthcheck --health-interval=2s --health-timeout=5s --health-start-period=20s --health-retries=3 \
      -v "$data:/var/lib/operatoros:U" "$api" >/dev/null
    podman run -d --name "$web_name" --network=container:"$api_name" \
      --health-cmd 'wget --quiet --tries=1 --spider http://127.0.0.1:8080/healthz' --health-interval=2s --health-timeout=5s --health-start-period=10s --health-retries=3 \
      -v "$temp/nginx.conf:/etc/nginx/conf.d/default.conf:ro" "$web" >/dev/null
    ready=0
    for _ in $(seq 1 30); do
      if podman exec "$web_name" wget --quiet --tries=1 -O - http://127.0.0.1:8080/healthz >/dev/null 2>&1 \
        && podman exec "$web_name" wget --quiet --tries=1 -O - http://127.0.0.1:8080/health 2>/dev/null | grep -Eq '"status":"ok"' \
        && podman exec "$web_name" wget --quiet --tries=1 -O - http://127.0.0.1:8080/api/system/health 2>/dev/null | grep -Eq '"service":"System API"' \
        && [ "$(podman inspect -f '{{.State.Health.Status}}' "$api_name")" = healthy ] \
        && [ "$(podman inspect -f '{{.State.Health.Status}}' "$web_name")" = healthy ]; then
        ready=1
        break
      fi
      sleep 1
    done
    [ "$ready" = 1 ] || { sanitized_logs "$api_name"; sanitized_logs "$web_name"; exit 1; }
    [ "$(podman inspect -f '{{.Config.User}}' "$api_name")" = bun ]
    [ "$(podman inspect -f '{{.State.Running}}' "$api_name")" = true ]
    podman stop --time 10 "$web_name" "$api_name" >/dev/null
    echo 'PASS: web health, proxied API health, rootless API user, bounded readiness and clean stop'
    ;;
  *) echo 'Usage: scripts/podman-ci.sh {doctor|build|smoke}' >&2; exit 2 ;;
esac

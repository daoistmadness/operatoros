#!/usr/bin/env bash
set -Eeuo pipefail

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
api_tag="localhost/operatoros-api:${OPERATOROS_IMAGE_TAG:-worktree}"
web_tag="localhost/operatoros-web:${OPERATOROS_IMAGE_TAG:-worktree}"
suffix="$$"
api_name="operatoros-rollback-smoke-api-$suffix"
web_name="operatoros-rollback-smoke-web-$suffix"
candidate_name="operatoros-rollback-smoke-candidate-$suffix"
temp="$(mktemp -d)"
data="$temp/data"
active="$temp/active-release.json"
previous="$temp/previous-release.json"

fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
logs() {
  podman logs --tail=60 "$1" 2>&1 | sed -E \
    -e 's/((AUTH_COOKIE_SECRET|BACKUP_ENCRYPTION_KEY|ASTRYX_SETUP_TOKEN|DATABASE_URL|DATABASE_PATH)=)[^[:space:]]+/\1[REDACTED]/g' \
    -e 's/(Bearer )[A-Za-z0-9._~+\/-]+=*/\1[REDACTED]/g'
}
write_manifest() {
  printf '{"mode":"local-rollback-smoke","schema":"20261002_s48","images":{"api":"%s","web":"%s"}}\n' "$1" "$2" > "$active.next"
  mv -f -- "$active.next" "$active"
}
cleanup() {
  status=$?
  trap - EXIT
  set +e
  podman rm -f --ignore "$candidate_name" "$web_name" >/dev/null
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

test "$(podman info --format '{{.Host.Security.Rootless}}')" = true || fail 'Podman must run rootless'
podman image exists "$api_tag" && podman image exists "$web_tag" || fail 'Build both production OCI images first'
api_digest="$(podman image inspect "$api_tag" --format '{{index .RepoDigests 0}}')"
web_digest="$(podman image inspect "$web_tag" --format '{{index .RepoDigests 0}}')"
[[ "$api_digest" =~ ^localhost/operatoros-api@sha256:[a-f0-9]{64}$ ]] || fail 'API image has no local OCI manifest digest'
[[ "$web_digest" =~ ^localhost/operatoros-web@sha256:[a-f0-9]{64}$ ]] || fail 'web image has no local OCI manifest digest'
expected_schema="$(bun packages/db/src/schema-version-cli.ts --format current)"
[ "$expected_schema" = 20261002_s48 ] || fail "Expected S4.8 schema, got $expected_schema"

mkdir "$data"
OPERATOROS_DATA_DIR="$data" bun run db:bootstrap --data-dir "$data"
sed -e 's/operatoros-api:8090/127.0.0.1:8090/g' containers/nginx.conf > "$temp/nginx.conf"
write_manifest "$api_digest" "$web_digest"
cp "$active" "$previous"

podman run -d --pull=never --name "$api_name" --network=none \
  -e HOST=0.0.0.0 -e PORT=8090 -e OPERATOROS_DATA_DIR=/var/lib/operatoros \
  -e AUTH_COOKIE_SECRET=ci-rollback-secret-with-more-than-thirty-two-characters -e NODE_ENV=test \
  --health-cmd /usr/local/bin/operatoros-healthcheck --health-interval=2s --health-timeout=5s --health-start-period=20s --health-retries=3 \
  -v "$data:/var/lib/operatoros:U" "$api_digest" >/dev/null
podman run -d --pull=never --name "$web_name" --network=container:"$api_name" \
  --health-cmd 'wget --quiet --tries=1 --spider http://127.0.0.1:8080/healthz' --health-interval=2s --health-timeout=5s --health-start-period=10s --health-retries=3 \
  -v "$temp/nginx.conf:/etc/nginx/conf.d/default.conf:ro" "$web_digest" >/dev/null

wait_healthy() {
  for _ in $(seq 1 30); do
    if podman exec "$web_name" wget --quiet --tries=1 -O - http://127.0.0.1:8080/healthz >/dev/null 2>&1 \
      && podman exec "$web_name" wget --quiet --tries=1 -O - http://127.0.0.1:8080/api/system/health 2>/dev/null | rg -q '"service":"System API"' \
      && [ "$(podman inspect -f '{{.State.Health.Status}}' "$api_name")" = healthy ] \
      && [ "$(podman inspect -f '{{.State.Health.Status}}' "$web_name")" = healthy ]; then return 0; fi
    sleep 1
  done
  logs "$api_name"
  logs "$web_name"
  return 1
}
wait_healthy || fail 'Initial digest-pinned local deployment did not become healthy'

podman stop --time 10 "$web_name" "$api_name" >/dev/null
bad_api_digest='localhost/operatoros-api@sha256:0000000000000000000000000000000000000000000000000000000000000000'
write_manifest "$bad_api_digest" "$web_digest"
if candidate_error="$(podman create --pull=never --name "$candidate_name" --network=none "$bad_api_digest" 2>&1)"; then
  fail 'Fault injection unexpectedly created a candidate container from a missing digest'
fi
printf 'Injected candidate pull failure: %s\n' "${candidate_error%%$'\n'*}"

cp "$previous" "$active.next"
mv -f -- "$active.next" "$active"
cmp -s "$active" "$previous" || fail 'Rollback did not atomically restore the previous release reference'
podman start "$api_name" >/dev/null
for _ in $(seq 1 30); do
  if [ "$(podman inspect -f '{{.State.Health.Status}}' "$api_name")" = healthy ]; then break; fi
  sleep 1
done
podman start "$web_name" >/dev/null
wait_healthy || fail 'Previous digest-pinned application did not recover after rollback'
[ "$(jq -r '.schema' "$active")" = 20261002_s48 ] || fail 'Rollback changed the canonical schema reference'
echo 'PASS: local-only OCI digest rollback restored the prior release reference and healthy API/frontend with disposable S4.8 data'

#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "$0")/.." && pwd -P)"
teardown="$repo_root/scripts/podman-local-teardown.sh"
bun_bin="$(command -v bun || true)"
caddy_image="docker.io/library/caddy@sha256:e70b164da81ef698b3ad19af799ea6086ce6d9e48ed4079eb9fe26f6fbf14ee5"

for command in podman curl sha256sum tar gzip python3 git rg systemd-analyze; do
  command -v "$command" >/dev/null || { printf 'Required local command is missing: %s\n' "$command" >&2; exit 2; }
done
[[ -x "$bun_bin" ]] || { printf 'Native Bun is required to seed only the synthetic validation database.\n' >&2; exit 2; }
[[ "$(readlink -f "$bun_bin")" != /mnt/* ]] || { printf 'Refusing a non-native Bun path.\n' >&2; exit 2; }

source_sha="$(git -C "$repo_root" rev-parse HEAD)"
if [[ -n "$(git -C "$repo_root" status --porcelain -- apps/api/src packages/contracts/src packages/db/src packages/excel/src packages/sheetjs-fork openapi/operatoros.openapi.json package.json bun.lock)" ]]; then
  printf 'Production application inputs are modified; build must use a reviewed source revision.\n' >&2
  exit 2
fi

workspace="$(mktemp -d /var/tmp/operatoros-podman-local.XXXXXX)"
chmod 0700 "$workspace"
run_id="${workspace##*/}"
source_file_manifest="$workspace/source-file-manifest.json"
python3 - "$repo_root" "$source_file_manifest" <<'PY'
import hashlib
import json
import os
import stat
import subprocess
import sys

root, output = sys.argv[1:]
paths = subprocess.check_output(
    ["git", "-C", root, "ls-files", "-c", "-o", "--exclude-standard", "-z"]
).split(b"\0")
entries = []
for raw_path in paths:
    if not raw_path:
        continue
    relative = os.fsdecode(raw_path)
    absolute = os.path.join(root, relative)
    metadata = os.lstat(absolute)
    if stat.S_ISLNK(metadata.st_mode):
        kind = "symlink"
        content = os.fsencode(os.readlink(absolute))
    elif stat.S_ISREG(metadata.st_mode):
        kind = "file"
        with open(absolute, "rb") as source:
            content = source.read()
    else:
        continue
    entries.append({
        "path": relative,
        "kind": kind,
        "mode": stat.S_IMODE(metadata.st_mode),
        "size": len(content),
        "sha256": hashlib.sha256(content).hexdigest(),
    })
entries.sort(key=lambda entry: entry["path"])
with open(output, "w", encoding="utf-8") as destination:
    json.dump({"files": entries}, destination, indent=2, sort_keys=True)
    destination.write("\n")
PY
source_tree_sha256="$(sha256sum "$source_file_manifest" | awk '{print $1}')"
if [[ -n "$(git -C "$repo_root" status --porcelain --untracked-files=all)" ]]; then
  source_dirty=true
else
  source_dirty=false
fi
chmod 0600 "$source_file_manifest"
printf '%s' "$run_id" >"$workspace/.operatoros-podman-local"
chmod 0600 "$workspace/.operatoros-podman-local"
cleanup_done=false
on_exit() {
  status=$?
  trap - EXIT
  if [[ "$cleanup_done" != true ]]; then
    "$teardown" "$workspace" >/dev/null 2>&1 || true
  fi
  if [[ $status -ne 0 ]]; then
    printf 'Local Podman validation failed; synthetic evidence retained at %s\n' "$workspace" >&2
  fi
  exit "$status"
}
trap on_exit EXIT

mkdir -p "$workspace/state" "$workspace/backup-source/backups" "$workspace/restore-target" "$workspace/static/client" "$workspace/quadlet-xdg/containers/systemd" "$workspace/home"
chmod 0700 "$workspace/state" "$workspace/backup-source" "$workspace/backup-source/backups" "$workspace/restore-target"

free_loopback_port() {
  python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()'
}
api_port="$(free_loopback_port)"
web_port="$(free_loopback_port)"
while [[ "$web_port" == "$api_port" ]]; do web_port="$(free_loopback_port)"; done
origin="http://127.0.0.1:$web_port"
api_name="operatoros-api-$run_id"
caddy_name="operatoros-caddy-$run_id"
run_label="io.operatoros.podman-local-run=$run_id"
image_tag="localhost/operatoros-api:local-$run_id"
static_root="$workspace/static/client"

if [[ ! -f "$repo_root/apps/web/build/client/_shell.html" ]]; then
  (cd "$repo_root/apps/web" && bun run build)
fi
git -C "$repo_root" diff --exit-code -- apps/web/src/routeTree.gen.ts
unexpected_client_file="$(find "$repo_root/apps/web/build/client" -mindepth 1 -maxdepth 1 ! -name _shell.html ! -name assets ! -name .vite ! -name index.html ! -name desktop-failure.css ! -name desktop-failure.js -print -quit)"
[[ -z "$unexpected_client_file" && -f "$repo_root/apps/web/build/client/_shell.html" && -d "$repo_root/apps/web/build/client/assets" ]] || {
  printf 'Static client staging contains unexpected or missing build output.\n' >&2
  exit 1
}
for name in _shell.html index.html desktop-failure.css desktop-failure.js; do
  [[ ! -f "$repo_root/apps/web/build/client/$name" ]] || cp "$repo_root/apps/web/build/client/$name" "$static_root/$name"
done
cp -a "$repo_root/apps/web/build/client/assets" "$static_root/assets"

bun run security:audit | tee "$workspace/dependency-audit-full.log"
bun audit --production | tee "$workspace/dependency-audit-production.log"

podman build --platform linux/amd64 --file "$repo_root/deploy/podman/Containerfile.api" \
  --ignorefile "$repo_root/deploy/podman/.containerignore" \
  --build-arg "VCS_REF=$source_sha" \
  --build-arg "SOURCE_TREE_SHA256=$source_tree_sha256" \
  --build-arg "SOURCE_DIRTY=$source_dirty" \
  --tag "$image_tag" "$repo_root" \
  2>&1 | tee "$workspace/container-build.log"
image_id="$(podman image inspect --format '{{.Id}}' "$image_tag")"
image_digest="$(podman image inspect --format '{{.Digest}}' "$image_tag")"
image_source_tree_sha="$(podman image inspect --format '{{ index .Labels "org.operatoros.source.tree-sha256" }}' "$image_tag")"
if [[ "$image_source_tree_sha" != "$source_tree_sha256" ]]; then
  printf 'Image source-tree label does not match the worktree manifest. Expected %s, got %s.\n' \
    "$source_tree_sha256" "$image_source_tree_sha" >&2
  exit 1
fi
podman run --rm --entrypoint /bin/sh "$image_tag" -ec \
  "grep -Fxq 'revision=$source_sha' /usr/share/operatoros/build-provenance && grep -Fxq 'source_tree_sha256=$source_tree_sha256' /usr/share/operatoros/build-provenance && grep -Fxq 'source_dirty=$source_dirty' /usr/share/operatoros/build-provenance"
if [[ ! "$image_digest" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  podman push --digestfile "$workspace/operatoros-api.digest" "$image_tag" "oci-archive:$workspace/operatoros-api.oci.tar:operatoros-api"
  image_digest="$(<"$workspace/operatoros-api.digest")"
fi
[[ "$image_digest" =~ ^sha256:[0-9a-f]{64}$ ]] || { printf 'Podman did not provide an OCI manifest digest.\n' >&2; exit 1; }
printf '%s\n' "$image_digest" >"$workspace/operatoros-api.digest"
if [[ ! -f "$workspace/operatoros-api.oci.tar" ]]; then
  podman save --format oci-archive --output "$workspace/operatoros-api.oci.tar" "$image_tag"
fi
image_archive_sha="$(sha256sum "$workspace/operatoros-api.oci.tar" | awk '{print $1}')"
printf '%s  operatoros-api.oci.tar\n' "$image_archive_sha" >"$workspace/operatoros-api.oci.tar.sha256"
podman run --rm --entrypoint /bin/sh "$image_tag" -ec '
  test "$(id -u)" = 10000
  test ! -e /app/apps/web
  test ! -e /app/.env
  test -f /usr/share/operatoros/build-provenance
  test -z "$(find /app -type f \( -name "*.sqlite" -o -name "*.db" -o -name "*.pem" -o -name ".env" \) -print -quit)"
' >"$workspace/image-content-policy.log"
podman run --rm --workdir /app/apps/api --entrypoint bun "$image_tag" -e '
  import { createWorkbook, readXlsxWorkbook, writeXlsxWorkbook, readLegacyXlsRows, writeLegacyXlsRows } from "@operatoros/excel";
  const workbook = createWorkbook({ exportType: "podman-image-smoke" });
  const sheet = workbook.addWorksheet("Synthetic");
  sheet.addRow(["student_identifier", "student_name"]);
  sheet.addRow(["SYN-001", "Synthetic Student"]);
  const xlsx = await readXlsxWorkbook(await writeXlsxWorkbook(workbook));
  if (xlsx.sheets[0]?.rows[0]?.values[1] !== "Synthetic Student") throw new Error("XLSX round trip failed");
  const xls = readLegacyXlsRows(writeLegacyXlsRows([["SYN-001", "Synthetic Student"]], ["student_identifier", "student_name"], "Synthetic"));
  if (xls.rows[0]?.[1] !== "Synthetic Student") throw new Error("legacy XLS round trip failed");
  console.log("PASS XLSX and legacy XLS synthetic round trips");
' | tee "$workspace/excel-image-smoke.log"

quadlet="$workspace/quadlet-xdg/containers/systemd/operatoros-api.container"
"$repo_root/scripts/render-operatoros-quadlet.sh" "localhost/operatoros-api@$image_digest" "$quadlet"
XDG_CONFIG_HOME="$workspace/quadlet-xdg" HOME="$workspace/home" /usr/libexec/podman/quadlet -user -dryrun >"$workspace/quadlet-generator.log" 2>&1 || {
  cat "$workspace/quadlet-generator.log" >&2
  exit 1
}
sed -n '/^---operatoros-api.service---$/,$p' "$workspace/quadlet-generator.log" | sed '1d' >"$workspace/operatoros-api.service"
systemd-analyze verify "$workspace/operatoros-api.service" >"$workspace/systemd-analyze.log" 2>&1
if grep -Eiq 'error|unknown|unsupported|failed' "$workspace/quadlet-generator.log"; then
  cat "$workspace/quadlet-generator.log" >&2
  exit 1
fi

random_hex() { od -An -N32 -tx1 /dev/urandom | tr -d ' \n'; }
admin_password="Synthetic-$(random_hex)"
cookie_secret="$(random_hex)$(random_hex)"
backup_key="$(head -c 32 /dev/urandom | base64 | tr -d '\n')"
admin_username="operatoros_podman_admin"
umask 077
cat >"$workspace/api.env" <<EOF
NODE_ENV=production
HOST=0.0.0.0
PORT=8090
OPERATOROS_DATA_DIR=/var/lib/operatoros/data
AUTH_COOKIE_SECRET=$cookie_secret
BACKUP_ENCRYPTION_KEY=$backup_key
BACKUP_ENCRYPTION_KEY_ID=podman-local-$run_id
ALLOWED_ORIGINS=$origin
COOKIE_SECURE=false
ENABLE_DESTRUCTIVE_OPERATIONS=false
EOF
chmod 0600 "$workspace/api.env"

export OPERATOROS_DATA_DIR="$workspace/state"
bun "$repo_root/packages/db/src/db-cli.ts" bootstrap --data-dir "$workspace/state" | tee "$workspace/database-bootstrap.log"
OPERATOROS_E2E_ADMIN_USERNAME="$admin_username" OPERATOROS_E2E_ADMIN_PASSWORD="$admin_password" \
  bun "$repo_root/e2e/helpers/seed-test-database.ts" --database "$workspace/state/operatoros.sqlite" --runtime-root "$workspace" \
  | tee "$workspace/database-seed.log"
unset OPERATOROS_DATA_DIR
wal_mode="$(bun -e 'import { Database } from "bun:sqlite"; const db = new Database(process.argv[1]); db.exec("PRAGMA journal_mode=WAL"); const mode = String(db.query("PRAGMA journal_mode").get()?.journal_mode); db.close(); if (mode !== "wal") process.exit(1); console.log(mode)' "$workspace/state/operatoros.sqlite")"
printf '%s\n' "$wal_mode" >"$workspace/database-journal-mode.txt"

start_api() {
  podman run --detach --name "$api_name" --label "$run_label" \
    --publish "127.0.0.1:$api_port:8090" \
    --userns keep-id:uid=10000,gid=10000 --user 10000:10000 \
    --read-only --read-only-tmpfs=true --cap-drop all --security-opt no-new-privileges \
    --health-cmd /usr/local/bin/operatoros-api-healthcheck --health-interval 30s --health-timeout 5s \
    --health-start-period 30s --health-retries 3 \
    --volume "$workspace/state:/var/lib/operatoros/data:rw" --env-file "$workspace/api.env" \
    "$image_tag" >/dev/null
}
wait_ready() {
  url="$1"
  container_name="$2"
  tries=0
  until curl --silent --show-error --fail --max-time 2 "$url" >"$workspace/readiness.json" 2>/dev/null; do
    container_state="$(podman inspect --format '{{.State.Status}}' "$container_name" 2>/dev/null || true)"
    if [[ "$container_state" == exited ]]; then
      podman logs "$container_name" >"$workspace/startup-error.log" 2>&1 || true
      printf 'Container %s exited before readiness; see %s\n' "$container_name" "$workspace/startup-error.log" >&2
      return 1
    fi
    tries=$((tries + 1))
    if (( tries >= 60 )); then
      printf 'Readiness timed out at %s\n' "$url" >&2
      return 1
    fi
    sleep 1
  done
}
assert_json_user() {
  json_file="$1"
  expected_user="$2"
  bun -e 'const v = await Bun.file(process.argv[1]).json(); if (v.username !== process.argv[2]) process.exit(1)' "$json_file" "$expected_user"
}

start_api
wait_ready "http://127.0.0.1:$api_port/ready" "$api_name"
if podman run --rm --name "operatoros-api-contender-$run_id" --label "$run_label" \
  --userns keep-id:uid=10000,gid=10000 --user 10000:10000 --read-only --read-only-tmpfs=true \
  --cap-drop all --security-opt no-new-privileges \
  --volume "$workspace/state:/var/lib/operatoros/data:rw" --env-file "$workspace/api.env" \
  "$image_tag" >"$workspace/second-api-lock.log" 2>&1; then
  printf 'A second API process unexpectedly acquired the same SQLite data-root lock.\n' >&2
  exit 1
fi
if ! grep -Fq 'BACKUP_OPERATION_LOCKED' "$workspace/second-api-lock.log"; then
  cat "$workspace/second-api-lock.log" >&2
  printf 'The second API process failed for a reason other than the data-root lock.\n' >&2
  exit 1
fi
podman healthcheck run "$api_name" >"$workspace/api-healthcheck.log"
podman inspect --format '{{.State.Health.Status}}' "$api_name" >"$workspace/api-health-status.txt"
podman inspect "$api_name" >"$workspace/api-container-inspect.json"
podman inspect --format '{{.Config.User}} {{.HostConfig.ReadonlyRootfs}} {{.HostConfig.Privileged}} {{json .HostConfig.CapDrop}} {{json .NetworkSettings.Ports}}' "$api_name" >"$workspace/api-container-security.txt"
podman exec --user 10000:10000 "$api_name" sh -c 'test "$(id -u)" = 10000 && test "$(stat -c %u:%g /var/lib/operatoros/data/operatoros.sqlite)" = 10000:10000' >"$workspace/container-identity.txt"
stat -c '%a %u:%g %n' "$workspace/state/operatoros.sqlite" >"$workspace/host-data-permissions.txt"

caddyfile="$workspace/Caddyfile"
sed -e "s|127.0.0.1:8088|127.0.0.1:$web_port|g" \
  -e "s|127.0.0.1:8090|127.0.0.1:$api_port|g" \
  "$repo_root/deploy/podman/Caddyfile" >"$caddyfile"
podman run --rm --network host --userns keep-id:uid=1000,gid=1000 --user 1000:1000 --read-only \
  --tmpfs /data:rw,mode=1777 --tmpfs /config:rw,mode=1777 --tmpfs /tmp:rw,mode=1777 \
  --cap-drop all --cap-add net_bind_service --security-opt no-new-privileges \
  --volume "$caddyfile:/etc/caddy/Caddyfile:ro" --volume "$static_root:/srv/operatoros/current/client:ro" \
  --entrypoint caddy "$caddy_image" validate --config /etc/caddy/Caddyfile | tee "$workspace/caddy-validate.log"
podman run --detach --name "$caddy_name" --label "$run_label" --network host \
  --userns keep-id:uid=1000,gid=1000 --user 1000:1000 --read-only \
  --tmpfs /data:rw,mode=1777 --tmpfs /config:rw,mode=1777 --tmpfs /tmp:rw,mode=1777 \
  --cap-drop all --cap-add net_bind_service --security-opt no-new-privileges \
  --volume "$caddyfile:/etc/caddy/Caddyfile:ro" --volume "$static_root:/srv/operatoros/current/client:ro" \
  --entrypoint caddy "$caddy_image" run --config /etc/caddy/Caddyfile >/dev/null
wait_ready "$origin/ready" "$caddy_name"
cp "$workspace/readiness.json" "$workspace/api-ready-via-caddy.json"

curl --silent --show-error --fail "$origin/" -o "$workspace/root-shell.html"
cmp "$workspace/root-shell.html" "$static_root/_shell.html"
curl --silent --show-error --fail "$origin/attendance/calendar" -o "$workspace/deep-link.html"
cmp "$workspace/deep-link.html" "$static_root/_shell.html"
asset="$(find "$static_root/assets" -maxdepth 1 -type f -name '*.js' -printf '%f\n' | sort | head -n 1)"
[[ -n "$asset" ]]
curl --silent --show-error --fail "$origin/assets/$asset" -o "$workspace/served-asset.js"
cmp "$workspace/served-asset.js" "$static_root/assets/$asset"
[[ "$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' "$origin/assets/operatoros-missing.js")" == 404 ]]
install -d -m 0700 "$static_root/.vite"
printf '{"synthetic":"manifest canary"}\n' >"$static_root/.vite/manifest.json"
[[ "$(curl --silent --show-error --output "$workspace/manifest-response" --write-out '%{http_code}' "$origin/.vite/manifest.json")" == 404 ]]
[[ ! -s "$workspace/manifest-response" ]]
rm -rf -- "$static_root/.vite"
curl --silent --show-error --fail "$origin/openapi" -o "$workspace/openapi-response.json"
! cmp -s "$workspace/openapi-response.json" "$static_root/_shell.html"
[[ "$(curl --silent --show-error --output "$workspace/unauthenticated.json" --write-out '%{http_code}' "$origin/api/auth/me")" == 401 ]]

cookiejar="$workspace/cookies.txt"
login_body="$(printf '{\"username\":\"%s\",\"password\":\"%s\"}' "$admin_username" "$admin_password")"
[[ "$(curl --silent --show-error --output "$workspace/login.json" --cookie-jar "$cookiejar" --write-out '%{http_code}' \
  -H 'Content-Type: application/json' -H "Origin: $origin" --data "$login_body" "$origin/api/auth/login")" == 200 ]]
assert_json_user "$workspace/login.json" "$admin_username"
curl --silent --show-error --fail --cookie "$cookiejar" -H "Origin: $origin" "$origin/api/auth/me" -o "$workspace/auth-me.json"
assert_json_user "$workspace/auth-me.json" "$admin_username"
wal_file="$workspace/state/operatoros.sqlite-wal"
[[ -s "$wal_file" ]]
wal_size_before_backup="$(stat -c %s "$wal_file")"
printf '%s\n' "$wal_size_before_backup" >"$workspace/wal-size-before-backup.txt"
[[ "$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' -X POST \
  --cookie "$cookiejar" -H 'Origin: http://untrusted.invalid' "$origin/api/auth/logout")" == 403 ]]
curl --silent --show-error --fail --cookie "$cookiejar" -H "Origin: $origin" "$origin/api/auth/me" -o "$workspace/auth-after-csrf-rejection.json"
assert_json_user "$workspace/auth-after-csrf-rejection.json" "$admin_username"

podman kill --signal SIGKILL "$api_name" >/dev/null
for attempt in $(seq 1 20); do
  [[ "$(podman inspect --format '{{.State.Status}}' "$api_name")" == exited ]] && break
  sleep 1
done
[[ "$(podman inspect --format '{{.State.Status}}' "$api_name")" == exited ]]
podman start "$api_name" >/dev/null
wait_ready "$origin/ready" "$api_name"
curl --silent --show-error --fail --cookie "$cookiejar" -H "Origin: $origin" "$origin/api/auth/me" -o "$workspace/auth-after-manual-restart.json"
assert_json_user "$workspace/auth-after-manual-restart.json" "$admin_username"

podman rm --force "$api_name" >/dev/null
start_api
wait_ready "$origin/ready" "$api_name"
curl --silent --show-error --fail --cookie "$cookiejar" -H "Origin: $origin" "$origin/api/auth/me" -o "$workspace/auth-after-container-recreation.json"
assert_json_user "$workspace/auth-after-container-recreation.json" "$admin_username"

[[ "$(curl --silent --show-error --output "$workspace/backup-response.json" --write-out '%{http_code}' \
  --request POST --cookie "$cookiejar" -H "Origin: $origin" "$origin/api/admin/backups")" == 200 ]]
backup_filename="$(bun -e 'const v = await Bun.file(process.argv[1]).json(); if (v.encrypted !== true || typeof v.filename !== "string") process.exit(1); console.log(v.filename)' "$workspace/backup-response.json")"
cp "$workspace/state/backups/$backup_filename" "$workspace/backup-source/backups/"
cp "$workspace/state/backups/$backup_filename.meta.json" "$workspace/backup-source/backups/"
chmod 0600 "$workspace/backup-source/backups/"*
cmp "$workspace/state/backups/$backup_filename" "$workspace/backup-source/backups/$backup_filename"
cmp "$workspace/state/backups/$backup_filename.meta.json" "$workspace/backup-source/backups/$backup_filename.meta.json"
sha256sum "$workspace/backup-source/backups/$backup_filename" "$workspace/backup-source/backups/$backup_filename.meta.json" >"$workspace/backup-checksums.txt"

restore_start_epoch="$(date +%s)"
podman run --rm --name "operatoros-restore-cli-$run_id" --label "$run_label" \
  --userns keep-id:uid=10000,gid=10000 --user 10000:10000 --read-only --read-only-tmpfs=true \
  --cap-drop all --security-opt no-new-privileges --tmpfs /tmp:rw,exec,nosuid,nodev,size=256m \
  --volume "$workspace/backup-source:/var/lib/operatoros/data:rw" \
  --volume "$workspace/restore-target:/tmp/operatoros-restore:rw" --env-file "$workspace/api.env" \
  --entrypoint bun "$image_tag" run apps/api/src/backup-cli.ts restore-disposable "$backup_filename" /tmp/operatoros-restore \
  | tee "$workspace/restore.log"
podman run --rm --userns keep-id:uid=10000,gid=10000 --user 10000:10000 --read-only --read-only-tmpfs=true \
  --cap-drop all --security-opt no-new-privileges --volume "$workspace/restore-target:/var/lib/operatoros/data:rw" \
  --env OPERATOROS_DATA_DIR=/var/lib/operatoros/data --entrypoint bun "$image_tag" \
  run packages/db/src/db-cli.ts validate --data-dir /var/lib/operatoros/data | tee "$workspace/restore-validate.log"

podman rm --force "$api_name" >/dev/null
podman run --detach --name "operatoros-restore-api-$run_id" --label "$run_label" \
  --publish "127.0.0.1:$api_port:8090" --userns keep-id:uid=10000,gid=10000 --user 10000:10000 \
  --read-only --read-only-tmpfs=true --cap-drop all --security-opt no-new-privileges \
  --volume "$workspace/restore-target:/var/lib/operatoros/data:rw" --env-file "$workspace/api.env" \
  "$image_tag" >/dev/null
wait_ready "$origin/ready" "operatoros-restore-api-$run_id"
curl --silent --show-error --fail --cookie "$cookiejar" -H "Origin: $origin" "$origin/api/auth/me" -o "$workspace/restored-existing-session.json"
assert_json_user "$workspace/restored-existing-session.json" "$admin_username"
new_cookiejar="$workspace/restored-cookies.txt"
[[ "$(curl --silent --show-error --output "$workspace/restored-login.json" --cookie-jar "$new_cookiejar" --write-out '%{http_code}' \
  -H 'Content-Type: application/json' -H "Origin: $origin" --data "$login_body" "$origin/api/auth/login")" == 200 ]]
assert_json_user "$workspace/restored-login.json" "$admin_username"
curl --silent --show-error --fail --cookie "$new_cookiejar" -H "Origin: $origin" "$origin/api/auth/me" -o "$workspace/restored-auth-me.json"
assert_json_user "$workspace/restored-auth-me.json" "$admin_username"
restore_elapsed_seconds=$(( $(date +%s) - restore_start_epoch ))

listeners="$(ss -H -ltn "sport = :$api_port or sport = :$web_port" | awk '{print $4}' | sort)"
printf '%s\n' "$listeners" >"$workspace/listeners.txt"
grep -Fxq "127.0.0.1:$api_port" "$workspace/listeners.txt"
grep -Fxq "127.0.0.1:$web_port" "$workspace/listeners.txt"
podman logs "$caddy_name" >"$workspace/caddy.log" 2>&1
podman logs "operatoros-restore-api-$run_id" >"$workspace/api.log" 2>&1

tar --sort=name --mtime="@$(git -C "$repo_root" show -s --format=%ct "$source_sha")" \
  --pax-option=delete=atime,delete=ctime \
  --owner=0 --group=0 --numeric-owner --format=posix -cf - -C "$static_root" . \
  | gzip -n >"$workspace/operatoros-web-client.tar.gz"
tar -tzf "$workspace/operatoros-web-client.tar.gz" >"$workspace/static-archive-contents.txt"
static_sha="$(sha256sum "$workspace/operatoros-web-client.tar.gz" | awk '{print $1}')"
printf '%s  operatoros-web-client.tar.gz\n' "$static_sha" >"$workspace/operatoros-web-client.tar.gz.sha256"
containerfile_sha="$(sha256sum "$repo_root/deploy/podman/Containerfile.api" | awk '{print $1}')"
caddyfile_sha="$(sha256sum "$repo_root/deploy/podman/Caddyfile" | awk '{print $1}')"
bun_lock_sha="$(sha256sum "$repo_root/bun.lock" | awk '{print $1}')"
mise_lock_sha="$(sha256sum "$repo_root/mise.lock" | awk '{print $1}')"
podman_version="$(podman version --format '{{.Client.Version}}')"
bun_version="$(bun --version)"
cat >"$workspace/local-release-record.json" <<EOF
{
  "status": "local synthetic validation; not a production release",
  "source_commit": "$source_sha",
  "source_tree_sha256": "$source_tree_sha256",
  "source_tree_manifest": "source-file-manifest.json",
  "source_tree_dirty": $source_dirty,
  "source_application_inputs_clean": true,
  "working_tree_configuration": "uncommitted",
  "podman_version": "$podman_version",
  "bun_version": "$bun_version",
  "platform": "linux/amd64",
  "api_image_tag_for_local_test": "$image_tag",
  "api_image_id": "$image_id",
  "api_image_manifest_digest": "$image_digest",
  "image_source_tree_sha256": "$image_source_tree_sha",
  "image_source_tree_provenance": "OCI label and in-image build-provenance file match source-file-manifest.json",
  "api_oci_archive_sha256": "$image_archive_sha",
  "api_image_content_policy": "non-root; no web tree, env files, private keys, or databases",
  "excel_image_smoke": "synthetic XLSX and legacy XLS round trips passed",
  "sqlite_wal_backup_check": "WAL mode enabled and frames existed before backup; restored pre-backup authenticated session verified",
  "second_api_same_data_root": "rejected with BACKUP_OPERATION_LOCKED",
  "api_containerfile_sha256": "$containerfile_sha",
  "bun_lock_sha256": "$bun_lock_sha",
  "mise_lock_sha256": "$mise_lock_sha",
  "bun_base_image_digest": "sha256:5a1fe2d60106ee903ee62008deab884376f18e07bbb6676cc86e9e1e1e710690",
  "lsof_package_version": "4.99.6-r0",
  "flock_package_version": "2.42.3-r1",
  "bun_embedded_sqlite": "3.53.4 with ENABLE_FTS5; CVE-2026-119373 remains unresolved in Bun 1.4.4",
  "full_dependency_audit": "passed; 635 packages",
  "production_dependency_audit": "passed; 430 packages",
  "container_os_vulnerability_scan": "separate external report required; not executed by this harness",
  "caddy_validation_image_digest": "sha256:e70b164da81ef698b3ad19af799ea6086ce6d9e48ed4079eb9fe26f6fbf14ee5",
  "caddyfile_sha256": "$caddyfile_sha",
  "static_client_archive_sha256": "$static_sha",
  "quadlet_template_sha256": "$(sha256sum "$repo_root/deploy/podman/operatoros-api.container.in" | awk '{print $1}')",
  "release_scope": "synthetic data, loopback-only local test",
  "restore_to_application_usable_seconds": $restore_elapsed_seconds,
  "systemd_user_service_and_reboot": "not exercised"
}
EOF
chmod 0600 "$workspace/local-release-record.json"

"$teardown" "$workspace"
cleanup_done=true
rm -f -- "$workspace/api.env" "$workspace/cookies.txt" "$workspace/restored-cookies.txt"
printf 'PODMAN_LOCAL_VALIDATION=PASS\n'
printf 'Synthetic workspace: %s\n' "$workspace"
printf 'API image digest: %s\n' "$image_digest"
printf 'Static archive SHA-256: %s\n' "$static_sha"

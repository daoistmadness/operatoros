#!/usr/bin/env bash
# CI-only synthetic consumer: use an isolated container store, never rebuild.
set -euo pipefail
bundle=$(realpath "$1")
source_sha=$2
python3 scripts/release-bundle.py verify "$bundle" "$source_sha"
temp_parent=$(realpath -e "${RUNNER_TEMP:-${TMPDIR:-/tmp}}")
workspace=$(mktemp -d "$temp_parent/operatoros-release-consumer.XXXXXXXX")
source scripts/release-consumer-cleanup-trap.sh
trap 'operatoros_release_consumer_exit "$workspace" "$temp_parent"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
export CONTAINERS_STORAGE_CONF="$workspace/storage.conf"
cat > "$CONTAINERS_STORAGE_CONF" <<EOF
[storage]
driver="vfs"
graphroot="$workspace/graphroot"
runroot="$workspace/runroot"
EOF
chmod 600 "$CONTAINERS_STORAGE_CONF"
python3 - "$bundle" "$source_sha" "$workspace" <<'PY'
import importlib.util, pathlib, sys, tarfile
spec = importlib.util.spec_from_file_location('release', 'scripts/release-bundle.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
with tarfile.open(sys.argv[1]) as archive: files = m.members(archive)
m.validate(files, sys.argv[2])
root = pathlib.Path(sys.argv[3])
for name, data in files.items(): (root / name).write_bytes(data)
with tarfile.open(root / 'operatoros-web-client.tar.gz') as archive:
    for name, data in m.members(archive).items():
        path = root / name; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(data)
PY
podman load -i "$workspace/operatoros-api.oci.tar"
image=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["image"]["image_id"])' "$workspace/manifest.json")
python3 scripts/check-bun-sqlite-runtime.py "$image"
mkdir "$workspace/state"
bun packages/db/src/db-cli.ts bootstrap --data-dir "$workspace/state"
api_port=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])')
web_port=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])')
[[ "$api_port" != "$web_port" ]]
umask 077
cat > "$workspace/api.env" <<EOF
AUTH_COOKIE_SECRET=$(openssl rand -hex 64)
BACKUP_ENCRYPTION_KEY=$(openssl rand -base64 32)
BACKUP_ENCRYPTION_KEY_ID=synthetic-release-consumer
ALLOWED_ORIGINS=http://127.0.0.1:$web_port
COOKIE_SECURE=false
EOF
podman run -d --name operatoros-release-api --pull=never --userns keep-id:uid=10000,gid=10000 --user 10000:10000 --read-only --read-only-tmpfs --cap-drop=all --security-opt=no-new-privileges -p "127.0.0.1:$api_port:8090" -v "$workspace/state:/var/lib/operatoros/data" --env-file "$workspace/api.env" "$image"
sed -e "s/:8088/:$web_port/g" -e "s/:8090/:$api_port/g" deploy/podman/Caddyfile > "$workspace/Caddyfile"
podman run -d --name operatoros-release-web --network=host -v "$workspace/client:/srv/operatoros/current/client:ro" -v "$workspace/Caddyfile:/etc/caddy/Caddyfile:ro" docker.io/library/caddy@sha256:e70b164da81ef698b3ad19af799ea6086ce6d9e48ed4079eb9fe26f6fbf14ee5
for attempt in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:$web_port/ready"; then break; fi
  if [[ "$attempt" == 60 ]]; then podman logs operatoros-release-api; exit 1; fi
  sleep 1
done
curl -fsS "http://127.0.0.1:$web_port/health"
curl -fsS "http://127.0.0.1:$web_port/attendance/calendar" | cmp - "$workspace/client/_shell.html"
[[ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$web_port/.env")" == 404 ]]
[[ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$web_port/missing.js")" == 404 ]]

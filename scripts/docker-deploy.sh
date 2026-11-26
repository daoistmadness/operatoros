#!/usr/bin/env bash
# OperatorOS Canonical Docker Compose Deployment and Rollback
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  cat <<'EOF'
Usage:
  scripts/docker-deploy.sh verify <candidate-archive.tar> <source-sha>
  scripts/docker-deploy.sh migrate <candidate-archive.tar> <source-sha> <target-schema> [deploy-dir]
  scripts/docker-deploy.sh deploy <candidate-archive.tar> <source-sha> [deploy-dir]
  scripts/docker-deploy.sh rollback [deploy-dir]
  scripts/docker-deploy.sh status [deploy-dir]

Environment:
  DOCKER_COMPOSE_COMMAND  Command to run docker compose (default: "docker compose")
  DOCKER_COMMAND          Docker CLI binary (default: "docker")
  OPERATOROS_DEPLOY_DIR   Deployment root (default: "/mnt/podman-data/operatoros/deploy")
  OPERATOROS_DATA_DIR     Data root (default: "/mnt/podman-data/operatoros/data")
  OPERATOROS_API_ENV_FILE Host-managed API env file (default: "<deploy-dir>/api.env" or compose env_file)
EOF
  exit 1
}

DOCKER_CMD="${DOCKER_COMPOSE_COMMAND:-docker compose}"
DOCKER_BIN="${DOCKER_COMMAND:-docker}"
DOCKER_USE_SUDO=""

init_docker_runner() {
  if [[ -n "$DOCKER_USE_SUDO" ]]; then
    return 0
  fi
  if [[ -n "${DOCKER_COMMAND:-}" ]]; then
    DOCKER_USE_SUDO="0"
    return 0
  fi
  if "$DOCKER_BIN" info >/dev/null 2>&1; then
    DOCKER_USE_SUDO="0"
  elif command -v sudo >/dev/null 2>&1 && sudo -n "$DOCKER_BIN" info >/dev/null 2>&1; then
    DOCKER_USE_SUDO="1"
  else
    printf 'Error: Docker daemon is not accessible via %s or sudo -n %s\n' "$DOCKER_BIN" "$DOCKER_BIN" >&2
    return 1
  fi
}

run_docker() {
  init_docker_runner
  if [[ "$DOCKER_USE_SUDO" == "1" ]]; then
    sudo -n "$DOCKER_BIN" "$@"
  else
    "$DOCKER_BIN" "$@"
  fi
}

run_compose() {
  if [[ -n "${DOCKER_COMPOSE_COMMAND:-}" ]]; then
    $DOCKER_CMD "$@"
    return $?
  fi
  init_docker_runner
  if [[ "$DOCKER_USE_SUDO" == "1" ]]; then
    sudo -n --preserve-env=OPERATOROS_API_IMAGE,OPERATOROS_CADDY_IMAGE,OPERATOROS_DEPLOY_DIR,OPERATOROS_DATA_DIR,OPERATOROS_API_ENV_FILE,OPERATOROS_WEB_ROOT,OPERATOROS_CADDYFILE,OPERATOROS_HTTP_PORT,OPERATOROS_API_PORT,OPERATOROS_ALLOWED_ORIGIN \
      $DOCKER_CMD "$@"
  else
    $DOCKER_CMD "$@"
  fi
}

acquire_lock() {
  local deploy_dir="$1"
  if [[ "${OPERATOROS_DEPLOY_LOCK_HELD:-0}" == "1" ]]; then
    return 0
  fi
  mkdir -p "$deploy_dir" || sudo -n mkdir -p "$deploy_dir"
  local lock_file="$deploy_dir/.deploy.lock"
  if [[ -L "$lock_file" ]]; then
    printf 'Error: Deployment lock path must not be a symlink: %s\n' "$lock_file" >&2
    return 1
  fi
  (umask 077 && touch "$lock_file") || sudo -n touch "$lock_file"
  chmod 0600 "$lock_file" 2>/dev/null || sudo -n chmod 0600 "$lock_file" 2>/dev/null || true
  exec 200>"$lock_file"
  if ! flock -n 200; then
    printf 'Error: Concurrent deployment or rollback in progress (lock held on %s)\n' "$lock_file" >&2
    return 1
  fi
  export OPERATOROS_DEPLOY_LOCK_HELD=1
}

assert_no_maintenance_lock() {
  local deploy_dir="$1"
  local maint_file="$deploy_dir/.maintenance_lock"
  if [[ -e "$maint_file" || -L "$maint_file" ]]; then
    printf 'Error: Maintenance lock is active at %s; resolve interrupted maintenance before proceeding.\n' "$maint_file" >&2
    return 1
  fi
}

enter_maintenance_mode() {
  local deploy_dir="$1"
  local sha="$2"
  local target_schema="$3"
  if [[ "${OPERATOROS_DEPLOY_LOCK_HELD:-0}" != "1" ]]; then
    printf 'Error: Maintenance mode requires active deployment lock.\n' >&2
    return 1
  fi
  local maint_file="$deploy_dir/.maintenance_lock"
  if [[ -L "$maint_file" ]]; then
    printf 'Error: Maintenance lock path must not be a symlink: %s\n' "$maint_file" >&2
    return 1
  fi
  if [[ -e "$maint_file" ]]; then
    printf 'Error: Existing maintenance lock found at %s; previous maintenance did not complete cleanly.\n' "$maint_file" >&2
    return 1
  fi
  (
    umask 077
    printf 'pid=%s\nsha=%s\ntarget_schema=%s\nstarted_at=%s\n' "$$" "$sha" "$target_schema" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$maint_file"
  ) || {
    printf 'Error: Failed to establish maintenance lock at %s\n' "$maint_file" >&2
    return 1
  }
  chmod 0600 "$maint_file"
}

exit_maintenance_mode() {
  local deploy_dir="$1"
  local maint_file="$deploy_dir/.maintenance_lock"
  rm -f "$maint_file"
}

resolve_compose_file() {
  local deploy_dir="$1"
  local release_dir="${2:-}"
  local fallback_compose="${OPERATOROS_COMPOSE_FALLBACK_FILE:-/home/mikhailryu/docker/operatoros/docker-compose.yml}"
  if [[ -f "$deploy_dir/docker-compose.yml" ]]; then
    printf '%s\n' "$deploy_dir/docker-compose.yml"
  elif [[ -f "$fallback_compose" ]]; then
    printf '%s\n' "$fallback_compose"
  elif [[ -n "$release_dir" && -f "$release_dir/deploy/docker/docker-compose.yml" ]]; then
    printf '%s\n' "$release_dir/deploy/docker/docker-compose.yml"
  elif [[ -d "$deploy_dir/current" && -f "$deploy_dir/current/deploy/docker/docker-compose.yml" ]]; then
    printf '%s\n' "$deploy_dir/current/deploy/docker/docker-compose.yml"
  else
    return 1
  fi
}

resolve_api_env_file() {
  local compose_file="$1"
  local deploy_dir="$2"
  local candidate="${OPERATOROS_API_ENV_FILE:-}"
  if [[ -z "$candidate" ]]; then
    candidate="$(python3 - "$compose_file" "$deploy_dir" <<'PY'
import pathlib, re, sys
compose_path = pathlib.Path(sys.argv[1])
deploy_dir = pathlib.Path(sys.argv[2])
text = compose_path.read_text(encoding="utf-8")
m = re.search(r"env_file:\s*\n\s*-\s*([^\s#]+)", text)
if m:
    val = m.group(1).strip().strip("'\"")
    if not val.startswith("${"):
        print(val)
        raise SystemExit(0)
default_env = deploy_dir / "api.env"
if default_env.is_file():
    print(default_env)
PY
)" || return 1
  fi
  if [[ -z "$candidate" ]]; then
    printf 'Error: Could not resolve authoritative API env file (set OPERATOROS_API_ENV_FILE or provide %s/api.env)\n' "$deploy_dir" >&2
    return 1
  fi
  python3 - "$candidate" <<'PY' || return 1
import pathlib, stat, sys
p = pathlib.Path(sys.argv[1])
if p.is_symlink():
    raise SystemExit(f"Error: API env file must not be a symlink: {p}")
if not p.is_file():
    raise SystemExit(f"Error: Authoritative API env file not found: {p}")
mode = stat.S_IMODE(p.stat().st_mode)
if mode & 0o077:
    raise SystemExit(f"Error: API env file permissions too permissive ({oct(mode)}): {p} (expected 0600)")
parsed = {}
for raw in p.read_text(encoding="utf-8").splitlines():
    line = raw.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    k, v = line.split("=", 1)
    parsed[k.strip()] = v.strip()
for req in ("BACKUP_ENCRYPTION_KEY", "BACKUP_ENCRYPTION_KEY_ID", "AUTH_COOKIE_SECRET"):
    if not parsed.get(req):
        raise SystemExit(f"Error: Mandatory secret {req} missing in API env file {p}")
PY
  printf '%s\n' "$candidate"
}

export_compose_env() {
  local compose_file="$1"
  local deploy_dir="$2"
  local data_dir="$3"
  local api_image="${4:-}"
  local caddy_image="${5:-}"
  local api_env_file="${6:-}"

  if [[ -n "$api_image" ]]; then
    export OPERATOROS_API_IMAGE="$api_image"
  fi
  if [[ -n "$caddy_image" ]]; then
    export OPERATOROS_CADDY_IMAGE="$caddy_image"
  fi
  export OPERATOROS_DEPLOY_DIR="$deploy_dir"
  export OPERATOROS_DATA_DIR="$data_dir"
  if [[ -n "$api_env_file" ]]; then
    export OPERATOROS_API_ENV_FILE="$api_env_file"
  fi
  local default_web_root
  default_web_root="$(dirname "$deploy_dir")/web/current/client"
  if [[ -z "${OPERATOROS_WEB_ROOT:-}" ]]; then
    if [[ -d "$default_web_root" ]]; then
      export OPERATOROS_WEB_ROOT="$default_web_root"
    else
      export OPERATOROS_WEB_ROOT="$deploy_dir/current/client"
    fi
  fi
  if [[ -z "${OPERATOROS_CADDYFILE:-}" ]]; then
    local compose_dir
    compose_dir="$(dirname "$compose_file")"
    if [[ -f "$compose_dir/Caddyfile" ]]; then
      export OPERATOROS_CADDYFILE="$compose_dir/Caddyfile"
    elif [[ -f "$deploy_dir/Caddyfile" ]]; then
      export OPERATOROS_CADDYFILE="$deploy_dir/Caddyfile"
    else
      export OPERATOROS_CADDYFILE="$ROOT_DIR/deploy/docker/Caddyfile"
    fi
  fi
}

validate_compose_config() {
  local compose_file="$1"
  if ! run_compose -p operatoros -f "$compose_file" config --quiet; then
    printf 'Error: Compose configuration validation failed for %s\n' "$compose_file" >&2
    return 1
  fi
  if ! grep -q "operatoros-api" "$compose_file"; then
    printf 'Error: Compose file %s does not define operatoros-api service\n' "$compose_file" >&2
    return 1
  fi
}

stop_and_exclude_writers() {
  local compose_file="$1"
  local data_dir="$2"

  printf 'Stopping operatoros-api writer via Compose (%s)...\n' "$compose_file"
  if ! run_compose -p operatoros -f "$compose_file" stop operatoros-api; then
    printf 'Error: Failed to stop operatoros-api via Compose (%s)\n' "$compose_file" >&2
    return 1
  fi

  # Prevent Docker daemon auto-restart of operatoros-api during maintenance
  if run_docker inspect operatoros-api >/dev/null 2>&1; then
    if ! run_docker update --restart=no operatoros-api >/dev/null; then
      printf 'Error: Failed to establish writer restart exclusion (--restart=no) on operatoros-api\n' >&2
      return 1
    fi
    local restart_policy
    restart_policy="$(run_docker inspect --format '{{.HostConfig.RestartPolicy.Name}}' operatoros-api 2>/dev/null || true)"
    if [[ "$restart_policy" != "no" ]]; then
      printf 'Error: Writer restart exclusion check failed (RestartPolicy=%s, expected no)\n' "$restart_policy" >&2
      return 1
    fi
  fi

  verify_no_running_container_writers "$data_dir"
}

verify_no_running_container_writers() {
  local data_dir="$1"
  local resolved_data_dir
  resolved_data_dir="$(python3 -c 'import pathlib, sys; print(pathlib.Path(sys.argv[1]).resolve())' "$data_dir")"

  local running_ids
  running_ids="$(run_docker ps -q 2>/dev/null || true)"
  if [[ -z "$running_ids" ]]; then
    return 0
  fi

  local inspected
  if ! inspected="$(run_docker inspect --format '{{.Name}} {{range .Mounts}}{{.Source}}|{{end}}' $running_ids 2>/dev/null)"; then
    printf 'Error: Unable to inspect running Docker containers to verify writer exclusion\n' >&2
    return 1
  fi

  python3 - "$resolved_data_dir" "$inspected" <<'PY'
import pathlib, sys
data_dir = pathlib.Path(sys.argv[1]).resolve()
for line in sys.argv[2].splitlines():
    line = line.strip()
    if not line:
        continue
    parts = line.split(" ", 1)
    name = parts[0].lstrip("/")
    mounts = parts[1].split("|") if len(parts) > 1 else []
    if name == "operatoros-api":
        raise SystemExit(f"Error: Database writer container still running: {name}")
    for m in mounts:
        m = m.strip()
        if not m:
            continue
        mp = pathlib.Path(m).resolve()
        if mp == data_dir or data_dir in mp.parents or mp in data_dir.parents:
            raise SystemExit(f"Error: Running container {name} mounts data directory {mp}")
PY
}

verify_writer_quiescence() {
  local data_dir="$1"
  local deploy_dir="${2:-}"
  if [[ -n "$deploy_dir" ]]; then
    local maint_file="$deploy_dir/.maintenance_lock"
    if [[ ! -f "$maint_file" || -L "$maint_file" ]]; then
      printf 'Error: Maintenance writer-exclusion lock missing or invalid at %s\n' "$maint_file" >&2
      return 1
    fi
  fi
  verify_no_running_container_writers "$data_dir"
  python3 "$ROOT_DIR/scripts/verify-writer-quiescence.py" "$data_dir" || \
    (command -v sudo >/dev/null 2>&1 && sudo -n python3 "$ROOT_DIR/scripts/verify-writer-quiescence.py" "$data_dir")
}

backup_sqlite_hot() {
  local data_dir="$1"
  local prefix="$2"
  local db_file="$data_dir/operatoros.sqlite"
  if [[ ! -f "$db_file" ]]; then
    return 0
  fi
  # Keep supplemental plaintext snapshots outside data_dir/backups so encrypted backup containment remains strict
  local snapshot_dir="$data_dir/.snapshots"
  if [[ -L "$snapshot_dir" ]]; then
    printf 'Error: Snapshot directory must not be a symlink: %s\n' "$snapshot_dir" >&2
    return 1
  fi
  mkdir -p "$snapshot_dir" || sudo -n mkdir -p "$snapshot_dir"
  chmod 0700 "$snapshot_dir" || sudo -n chmod 0700 "$snapshot_dir"
  local backup_file="$snapshot_dir/${prefix}_$(date -u +%Y-%m-%dT%H-%M-%SZ).sqlite3"
  printf 'Creating protected SQLite hot snapshot at %s...\n' "$backup_file"
  (
    umask 077
    python3 -c "import sqlite3, sys; s=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro', uri=True); d=sqlite3.connect(sys.argv[2]); s.backup(d); d.close(); s.close()" "$db_file" "$backup_file"
  ) || (
    umask 077
    sudo -n python3 -c "import sqlite3, sys; s=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro', uri=True); d=sqlite3.connect(sys.argv[2]); s.backup(d); d.close(); s.close()" "$db_file" "$backup_file"
  )
  chmod 0600 "$backup_file" || sudo -n chmod 0600 "$backup_file"
  printf 'Verifying SQLite snapshot integrity and foreign keys...\n'
  python3 -c "import sqlite3, sys; con=sqlite3.connect(sys.argv[1]); res=con.execute('PRAGMA integrity_check').fetchone()[0]; fk=con.execute('PRAGMA foreign_key_check').fetchall(); con.close(); assert res == 'ok', f'Integrity check failed: {res}'; assert fk == [], f'Foreign key check failed: {fk}'" "$backup_file" \
    || sudo -n python3 -c "import sqlite3, sys; con=sqlite3.connect(sys.argv[1]); res=con.execute('PRAGMA integrity_check').fetchone()[0]; fk=con.execute('PRAGMA foreign_key_check').fetchall(); con.close(); assert res == 'ok', f'Integrity check failed: {res}'; assert fk == [], f'Foreign key check failed: {fk}'" "$backup_file"
}

create_and_verify_encrypted_backup() {
  local api_image="$1"
  local api_env_file="$2"
  local data_dir="$3"

  printf 'Creating attachment-aware encrypted backup via %s...\n' "$api_image"
  local backup_output
  if ! backup_output="$(run_docker run --rm --entrypoint bun --user 1000:1000 \
      --env-file "$api_env_file" \
      -e OPERATOROS_DATA_DIR=/var/lib/operatoros/data \
      -v "$data_dir:/var/lib/operatoros/data:rw" \
      "$api_image" \
      apps/api/src/backup-cli.ts backup)"; then
    printf 'Error: Attachment-aware encrypted backup creation failed.\n' >&2
    return 1
  fi
  printf '%s\n' "$backup_output"

  local backup_filename
  backup_filename="$(printf '%s\n' "$backup_output" | sed -n 's/^Encrypted backup completed: .*\/\(backup_[^/]*\.sqlite3\)$/\1/p' | tail -n 1)"
  if [[ -z "$backup_filename" ]]; then
    printf 'Error: Could not determine encrypted backup filename from backup-cli output.\n' >&2
    return 1
  fi

  printf 'Verifying independent disposable restore of %s...\n' "$backup_filename"
  local backup_artifact="$data_dir/backups/$backup_filename"
  local backup_meta="${backup_artifact}.meta.json"
  python3 - "$backup_artifact" "$backup_meta" <<'PY'
import pathlib, stat, sys
for raw in sys.argv[1:]:
    p = pathlib.Path(raw)
    if not p.is_file() or p.is_symlink():
        raise SystemExit(f"Error: Expected encrypted backup artifact missing or invalid: {p}")
    mode = stat.S_IMODE(p.stat().st_mode)
    if mode & 0o077:
        raise SystemExit(f"Error: Encrypted backup artifact permissions too permissive ({oct(mode)}): {p}")
PY
  local restore_output
  if ! restore_output="$(run_docker run --rm --entrypoint sh --user 1000:1000 \
      --env-file "$api_env_file" \
      -e OPERATOROS_DATA_DIR=/var/lib/operatoros/data \
      -v "$data_dir:/var/lib/operatoros/data:rw" \
      "$api_image" \
      -c 'set -eu; d=$(mktemp -d /tmp/operatoros-restore-verify-XXXXXX); chmod 700 "$d"; trap "rm -rf \"$d\"" EXIT; bun apps/api/src/backup-cli.ts restore-disposable "$1" "$d"' -- "$backup_filename")"; then
    printf 'Error: Independent disposable restore verification failed for %s.\n' "$backup_filename" >&2
    return 1
  fi
  printf '%s\n' "$restore_output"
  if ! printf '%s\n' "$restore_output" | grep -q "RESTORED_DISPOSABLE"; then
    printf 'Error: Disposable restore verification did not report RESTORED_DISPOSABLE.\n' >&2
    return 1
  fi
}

sync_compose_images() {
  local compose_file="$1"
  local api_image="$2"
  local caddy_image="$3"
  python3 - "$compose_file" "$api_image" "$caddy_image" <<'PY'
import pathlib, re, sys
path = pathlib.Path(sys.argv[1])
api_img, caddy_img = sys.argv[2], sys.argv[3]
text = path.read_text(encoding="utf-8")
if api_img:
    text = re.sub(r"(image:\s*)localhost/operatoros-api:[^\s]+", rf"\1{api_img}", text)
if caddy_img:
    text = re.sub(r"(image:\s*)localhost/operatoros-caddy:[^\s]+", rf"\1{caddy_img}", text)
path.write_text(text, encoding="utf-8")
PY
}

resolve_target_schema() {
  local target_release="$1"
  local target_schema=""
  if [[ -f "$ROOT_DIR/packages/db/src/manifest.ts" ]]; then
    target_schema="$(python3 -c "import re; from pathlib import Path; print(re.findall(r'\"([^\"]+)\"', re.search(r'SCHEMA_MIGRATIONS\s*=\s*\[(.*?)\]\s*as\s*const', Path('$ROOT_DIR/packages/db/src/manifest.ts').read_text(), re.DOTALL).group(1))[-1])" 2>/dev/null || true)"
  fi
  if [[ -z "$target_schema" ]] && command -v bun >/dev/null 2>&1; then
    target_schema="$(bun "$ROOT_DIR/packages/db/src/schema-version-cli.ts" --format current 2>/dev/null || true)"
  fi
  if [[ -n "$target_schema" ]]; then
    printf '%s\n' "$target_schema" > "$target_release/.schema_version"
  fi
}

verify_health_endpoints() {
  local http_port="${OPERATOROS_HTTP_PORT:-18088}"
  local api_port="${OPERATOROS_API_PORT:-18090}"
  local max_attempts="${OPERATOROS_HEALTHCHECK_ATTEMPTS:-30}"
  local sleep_seconds="${OPERATOROS_HEALTHCHECK_INTERVAL:-2}"

  printf 'Waiting for services to become healthy...\n'
  local healthy=0
  for _ in $(seq 1 "$max_attempts"); do
    if curl -sf --max-time 2 "http://127.0.0.1:${http_port}/health" >/dev/null 2>&1 && \
       curl -sf --max-time 2 "http://127.0.0.1:${http_port}/ready" >/dev/null 2>&1 && \
       curl -sf --max-time 2 "http://127.0.0.1:${api_port}/health" >/dev/null 2>&1; then
      healthy=1
      break
    fi
    sleep "$sleep_seconds"
  done
  [[ "$healthy" -eq 1 ]]
}

activate_release() {
  local archive="$1"
  local sha="$2"
  local deploy_dir="$3"
  local data_dir="$4"
  local compose_file="$5"
  local api_image="$6"
  local caddy_image="$7"
  local explicit_schema="${8:-}"

  local releases_dir="$deploy_dir/releases"
  local target_release="$releases_dir/$sha"
  local current_link="$deploy_dir/current"
  local prev_release=""

  mkdir -p "$releases_dir"
  if [[ -L "$current_link" ]]; then
    prev_release="$(readlink -f "$current_link" || true)"
  fi

  printf 'Extracting release to %s...\n' "$target_release"
  rm -rf "$target_release"
  python3 "$ROOT_DIR/scripts/docker-candidate-release.py" extract "$archive" "$sha" "$target_release"

  for img in "$target_release"/*.tar; do
    if [[ -f "$img" && "$img" != "$archive" ]]; then
      printf 'Loading image %s into Docker...\n' "$(basename "$img")"
      run_docker load -i "$img"
    fi
  done

  if [[ -n "$explicit_schema" ]]; then
    printf '%s\n' "$explicit_schema" > "$target_release/.schema_version"
  else
    resolve_target_schema "$target_release"
  fi

  if [[ -n "$prev_release" && "$prev_release" != "$target_release" ]]; then
    printf '%s\n' "$prev_release" > "$deploy_dir/.previous_release"
    if [[ -f "$prev_release/.schema_version" ]]; then
      cp -f "$prev_release/.schema_version" "$deploy_dir/.previous_schema_version" || true
    fi
  fi

  ln -sfn "$target_release" "$current_link"

  local web_dir
  web_dir="$(dirname "$deploy_dir")/web"
  if [[ -d "$web_dir" ]]; then
    ln -sfn "$target_release" "$web_dir/current" || sudo -n ln -sfn "$target_release" "$web_dir/current"
  fi

  if [[ "$compose_file" == "$deploy_dir/docker-compose.yml" ]]; then
    cp -f "$compose_file" "$deploy_dir/.previous_compose.yml"
    sync_compose_images "$compose_file" "$api_image" "$caddy_image"
  fi

  export_compose_env "$compose_file" "$deploy_dir" "$data_dir" "$api_image" "$caddy_image" "${OPERATOROS_API_ENV_FILE:-}"
  printf 'Applying Docker Compose configuration from %s (API=%s, Caddy=%s)...\n' "$compose_file" "$api_image" "$caddy_image"
  run_compose -p operatoros -f "$compose_file" up -d --remove-orphans
}

cmd_verify() {
  local archive="$1"
  local sha="$2"
  if [[ ! -f "$archive" ]]; then
    printf 'Error: Archive not found: %s\n' "$archive" >&2
    return 1
  fi
  printf 'Verifying release archive %s for commit %s...\n' "$archive" "$sha"
  python3 "$ROOT_DIR/scripts/docker-candidate-release.py" verify "$archive" "$sha" || return 1
}

recover_from_failed_migration() {
  local deploy_dir="$1"
  local data_dir="$2"
  local compose_file="$3"
  local prev_release=""

  if [[ -L "$deploy_dir/current" ]]; then
    prev_release="$(readlink -f "$deploy_dir/current" || true)"
  fi

  if [[ -n "$prev_release" && -d "$prev_release" && -f "$ROOT_DIR/scripts/verify-rollback-schema.py" ]]; then
    if python3 "$ROOT_DIR/scripts/verify-rollback-schema.py" "$data_dir" "$prev_release" "$deploy_dir" >/dev/null 2>&1; then
      printf 'Database remains compatible with active release %s; restoring service.\n' "$prev_release" >&2
      if run_docker inspect operatoros-api >/dev/null 2>&1; then
        run_docker update --restart=unless-stopped operatoros-api >/dev/null 2>&1 || true
      fi
      if run_compose -p operatoros -f "$compose_file" start operatoros-api >/dev/null 2>&1; then
        exit_maintenance_mode "$deploy_dir"
        return 0
      fi
    fi
  fi

  printf 'CRITICAL: Refusing to restart previous application against potentially migrated or incompatible database. Maintenance lock retained at %s/.maintenance_lock.\n' "$deploy_dir" >&2
  return 1
}

cmd_migrate() {
  local archive="$1"
  local sha="$2"
  local target_schema="$3"
  local deploy_dir="${4:-${OPERATOROS_DEPLOY_DIR:-/mnt/podman-data/operatoros/deploy}}"
  local data_dir="${OPERATOROS_DATA_DIR:-/mnt/podman-data/operatoros/data}"

  acquire_lock "$deploy_dir"
  assert_no_maintenance_lock "$deploy_dir"

  local verify_json
  verify_json="$(cmd_verify "$archive" "$sha")"
  printf '%s\n' "$verify_json"

  local api_image caddy_image
  api_image="$(python3 -c 'import json, sys; payload = sys.argv[1].split("\n", 1)[1] if sys.argv[1].startswith("Verifying ") else sys.argv[1]; d=json.loads(payload); print(d["manifest"]["api_image"]["reference"])' "$verify_json")"
  caddy_image="$(python3 -c 'import json, sys; payload = sys.argv[1].split("\n", 1)[1] if sys.argv[1].startswith("Verifying ") else sys.argv[1]; d=json.loads(payload); print(d["manifest"]["caddy_image"]["reference"])' "$verify_json")"
  if [[ -z "$api_image" || -z "$caddy_image" ]]; then
    printf 'Error: Could not resolve api_image and caddy_image references from verified archive\n' >&2
    return 1
  fi

  local compose_file=""
  if ! compose_file="$(resolve_compose_file "$deploy_dir" "")"; then
    printf 'Error: Authoritative docker-compose.yml could not be resolved for migration in %s\n' "$deploy_dir" >&2
    return 1
  fi

  local api_env_file
  api_env_file="$(resolve_api_env_file "$compose_file" "$deploy_dir")"
  export_compose_env "$compose_file" "$deploy_dir" "$data_dir" "$api_image" "$caddy_image" "$api_env_file"
  validate_compose_config "$compose_file"

  local tmp_extract
  tmp_extract="$(mktemp -d "${TMPDIR:-/tmp}/operatoros-migrate-extract-XXXXXX")"
  chmod 0700 "$tmp_extract"
  trap 'rm -rf "$tmp_extract"' RETURN
  local extract_payload="$tmp_extract/payload"
  python3 "$ROOT_DIR/scripts/docker-candidate-release.py" extract "$archive" "$sha" "$extract_payload" >/dev/null
  if [[ -f "$extract_payload/docker-images.tar" ]]; then
    run_docker load -i "$extract_payload/docker-images.tar"
  fi

  enter_maintenance_mode "$deploy_dir" "$sha" "$target_schema"
  if ! stop_and_exclude_writers "$compose_file" "$data_dir"; then
    exit_maintenance_mode "$deploy_dir"
    return 1
  fi

  if ! verify_writer_quiescence "$data_dir" "$deploy_dir"; then
    recover_from_failed_migration "$deploy_dir" "$data_dir" "$compose_file" || true
    return 1
  fi

  if ! create_and_verify_encrypted_backup "$api_image" "$api_env_file" "$data_dir"; then
    recover_from_failed_migration "$deploy_dir" "$data_dir" "$compose_file" || true
    return 1
  fi

  if ! verify_writer_quiescence "$data_dir" "$deploy_dir"; then
    recover_from_failed_migration "$deploy_dir" "$data_dir" "$compose_file" || true
    return 1
  fi

  printf 'Executing operational migration to %s using %s...\n' "$target_schema" "$api_image"
  if ! run_docker run --rm --entrypoint bun --user 1000:1000 \
      -e OPERATOROS_OPERATIONAL_MIGRATION_WRAPPER=docker-deploy-v1 \
      -v "$data_dir:/var/lib/operatoros/data:rw" \
      "$api_image" \
      packages/db/src/db-cli.ts migrate-operational --data-dir /var/lib/operatoros/data --authorize-target "$target_schema"; then
    printf 'Error: Operational migration failed.\n' >&2
    recover_from_failed_migration "$deploy_dir" "$data_dir" "$compose_file" || true
    return 1
  fi

  printf 'Validating migrated database against %s...\n' "$api_image"
  if ! run_docker run --rm --entrypoint bun --user 1000:1000 \
      -v "$data_dir:/var/lib/operatoros/data:ro" \
      "$api_image" \
      packages/db/src/db-cli.ts validate --data-dir /var/lib/operatoros/data; then
    printf 'Error: Migrated database failed post-migration validation. Keeping writer stopped.\n' >&2
    return 1
  fi

  if ! verify_writer_quiescence "$data_dir" "$deploy_dir"; then
    printf 'Error: Writer quiescence boundary violated before release activation.\n' >&2
    return 1
  fi

  if ! activate_release "$archive" "$sha" "$deploy_dir" "$data_dir" "$compose_file" "$api_image" "$caddy_image" "$target_schema"; then
    printf 'Error: Release activation failed after database migration. Refusing automatic rollback to incompatible release.\n' >&2
    return 1
  fi

  exit_maintenance_mode "$deploy_dir"

  if verify_health_endpoints; then
    printf 'Operational migration and deployment of %s (%s) successful and verified healthy.\n' "$sha" "$target_schema"
    return 0
  else
    printf 'Error: Healthcheck failed after migrated activation. Refusing automatic rollback to incompatible prior release.\n' >&2
    return 1
  fi
}

cmd_deploy() {
  local archive="$1"
  local sha="$2"
  local deploy_dir="${3:-${OPERATOROS_DEPLOY_DIR:-/mnt/podman-data/operatoros/deploy}}"
  local data_dir="${OPERATOROS_DATA_DIR:-/mnt/podman-data/operatoros/data}"

  acquire_lock "$deploy_dir"
  assert_no_maintenance_lock "$deploy_dir"

  local verify_json
  verify_json="$(cmd_verify "$archive" "$sha")"
  printf '%s\n' "$verify_json"

  local api_image caddy_image
  api_image="$(python3 -c 'import json, sys; payload = sys.argv[1].split("\n", 1)[1] if sys.argv[1].startswith("Verifying ") else sys.argv[1]; d=json.loads(payload); print(d["manifest"]["api_image"]["reference"])' "$verify_json")"
  caddy_image="$(python3 -c 'import json, sys; payload = sys.argv[1].split("\n", 1)[1] if sys.argv[1].startswith("Verifying ") else sys.argv[1]; d=json.loads(payload); print(d["manifest"]["caddy_image"]["reference"])' "$verify_json")"

  local compose_file=""
  compose_file="$(resolve_compose_file "$deploy_dir" "$deploy_dir/releases/$sha" || true)"

  local tmp_extract
  tmp_extract="$(mktemp -d "${TMPDIR:-/tmp}/operatoros-deploy-extract-XXXXXX")"
  chmod 0700 "$tmp_extract"
  trap 'rm -rf "$tmp_extract"' RETURN
  local extract_payload="$tmp_extract/payload"
  python3 "$ROOT_DIR/scripts/docker-candidate-release.py" extract "$archive" "$sha" "$extract_payload" >/dev/null
  if [[ -z "$compose_file" ]]; then
    compose_file="$(resolve_compose_file "$deploy_dir" "$extract_payload")" || {
      printf 'Error: No docker-compose.yml found in %s, fallback, or %s\n' "$deploy_dir" "$extract_payload" >&2
      return 1
    }
  fi

  local api_env_file
  api_env_file="$(resolve_api_env_file "$compose_file" "$deploy_dir")"
  export_compose_env "$compose_file" "$deploy_dir" "$data_dir" "$api_image" "$caddy_image" "$api_env_file"
  validate_compose_config "$compose_file"

  if [[ -f "$extract_payload/docker-images.tar" ]]; then
    run_docker load -i "$extract_payload/docker-images.tar"
  fi

  if [[ -f "$data_dir/operatoros.sqlite" ]]; then
    printf 'Validating database compatibility against %s...\n' "$api_image"
    if ! run_docker run --rm --entrypoint bun --user 1000:1000 \
        -v "$data_dir:/var/lib/operatoros/data:ro" \
        "$api_image" \
        packages/db/src/db-cli.ts validate --data-dir /var/lib/operatoros/data; then
      printf 'Error: Database schema is not compatible with %s; run scripts/docker-deploy.sh migrate instead.\n' "$api_image" >&2
      return 1
    fi
  fi

  backup_sqlite_hot "$data_dir" "predeploy"
  activate_release "$archive" "$sha" "$deploy_dir" "$data_dir" "$compose_file" "$api_image" "$caddy_image"

  if verify_health_endpoints; then
    printf 'Deployment of %s successful and verified healthy.\n' "$sha"
    return 0
  else
    printf 'Error: Healthcheck failed after deployment. Rolling back...\n' >&2
    cmd_rollback "$deploy_dir"
    return 1
  fi
}

cmd_rollback() {
  local deploy_dir="${1:-${OPERATOROS_DEPLOY_DIR:-/mnt/podman-data/operatoros/deploy}}"
  local data_dir="${OPERATOROS_DATA_DIR:-/mnt/podman-data/operatoros/data}"
  local prev_file="$deploy_dir/.previous_release"
  local current_link="$deploy_dir/current"

  acquire_lock "$deploy_dir"
  assert_no_maintenance_lock "$deploy_dir"

  if [[ ! -f "$prev_file" ]]; then
    printf 'Error: No previous release recorded at %s\n' "$prev_file" >&2
    return 1
  fi

  local prev_release
  prev_release="$(cat "$prev_file")"
  if [[ ! -d "$prev_release" ]]; then
    printf 'Error: Recorded previous release directory does not exist: %s\n' "$prev_release" >&2
    return 1
  fi

  local fallback_compose="${OPERATOROS_COMPOSE_FALLBACK_FILE:-/home/mikhailryu/docker/operatoros/docker-compose.yml}"
  local compose_file=""
  if [[ -f "$deploy_dir/docker-compose.yml" ]]; then
    compose_file="$deploy_dir/docker-compose.yml"
  elif [[ -f "$fallback_compose" ]]; then
    compose_file="$fallback_compose"
  elif [[ -f "$prev_release/deploy/docker/docker-compose.yml" ]]; then
    compose_file="$prev_release/deploy/docker/docker-compose.yml"
  fi

  if [[ -z "$compose_file" || ! -f "$compose_file" ]]; then
    printf 'Error: No docker-compose.yml found for rollback in %s, %s, or %s\n' "$deploy_dir" "$fallback_compose" "$prev_release" >&2
    return 1
  fi

  if [[ -f "$ROOT_DIR/scripts/verify-rollback-schema.py" ]]; then
    python3 "$ROOT_DIR/scripts/verify-rollback-schema.py" "$data_dir" "$prev_release" "$deploy_dir" || \
      (command -v sudo >/dev/null 2>&1 && sudo -n python3 "$ROOT_DIR/scripts/verify-rollback-schema.py" "$data_dir" "$prev_release" "$deploy_dir")
  fi

  printf 'Rolling back to previous release: %s\n' "$prev_release"
  ln -sfn "$prev_release" "$current_link"

  local web_dir
  web_dir="$(dirname "$deploy_dir")/web"
  if [[ -d "$web_dir" ]]; then
    ln -sfn "$prev_release" "$web_dir/current" || sudo -n ln -sfn "$prev_release" "$web_dir/current"
  fi

  if [[ -f "$deploy_dir/.previous_compose.yml" && "$compose_file" == "$deploy_dir/docker-compose.yml" ]]; then
    cp -f "$deploy_dir/.previous_compose.yml" "$compose_file"
  fi

  export_compose_env "$compose_file" "$deploy_dir" "$data_dir"
  printf 'Applying Docker Compose configuration from %s...\n' "$compose_file"
  run_compose -p operatoros -f "$compose_file" up -d --remove-orphans
  printf 'Rollback complete. Checking health...\n'
  sleep 3
  curl -sf "http://127.0.0.1:${OPERATOROS_HTTP_PORT:-18088}/health" || sudo -n curl -sf "http://127.0.0.1:${OPERATOROS_HTTP_PORT:-18088}/health"
}

cmd_status() {
  local deploy_dir="${1:-${OPERATOROS_DEPLOY_DIR:-/mnt/podman-data/operatoros/deploy}}"
  local compose_file=""
  if ! compose_file="$(resolve_compose_file "$deploy_dir" "")"; then
    printf 'Error: No docker-compose.yml found for status\n' >&2
    return 1
  fi
  export_compose_env "$compose_file" "$deploy_dir" "${OPERATOROS_DATA_DIR:-/mnt/podman-data/operatoros/data}"
  run_compose -p operatoros -f "$compose_file" ps
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  case "${1:-}" in
    verify)
      [[ $# -ge 3 ]] || usage
      cmd_verify "$2" "$3"
      ;;
    migrate)
      [[ $# -ge 4 ]] || usage
      cmd_migrate "$2" "$3" "$4" "${5:-}"
      ;;
    deploy)
      [[ $# -ge 3 ]] || usage
      cmd_deploy "$2" "$3" "${4:-}"
      ;;
    rollback)
      cmd_rollback "${2:-}"
      ;;
    status)
      cmd_status "${2:-}"
      ;;
    *)
      usage
      ;;
  esac
fi

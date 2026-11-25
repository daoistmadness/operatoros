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
  OPERATOROS_DEPLOY_DIR   Deployment root (default: "/mnt/podman-data/operatoros/deploy")
  OPERATOROS_DATA_DIR     Data root (default: "/mnt/podman-data/operatoros/data")
EOF
  exit 1
}

DOCKER_CMD="${DOCKER_COMPOSE_COMMAND:-docker compose}"

acquire_lock() {
  local deploy_dir="$1"
  if [[ "${OPERATOROS_DEPLOY_LOCK_HELD:-0}" == "1" ]]; then
    return 0
  fi
  mkdir -p "$deploy_dir" || sudo -n mkdir -p "$deploy_dir"
  local lock_file="$deploy_dir/.deploy.lock"
  exec 200>"$lock_file"
  if ! flock -n 200; then
    printf 'Error: Concurrent deployment or rollback in progress (lock held on %s)\n' "$lock_file" >&2
    return 1
  fi
  export OPERATOROS_DEPLOY_LOCK_HELD=1
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
  else
    return 1
  fi
}

backup_sqlite_hot() {
  local data_dir="$1"
  local prefix="$2"
  local db_file="$data_dir/operatoros.sqlite"
  if [[ ! -f "$db_file" ]]; then
    return 0
  fi
  local backup_dir="$data_dir/backups"
  mkdir -p "$backup_dir" || sudo -n mkdir -p "$backup_dir"
  local backup_file="$backup_dir/${prefix}_$(date -u +%Y-%m-%dT%H-%M-%SZ).sqlite3"
  printf 'Creating SQLite hot backup at %s...\n' "$backup_file"
  python3 -c "import sqlite3, sys; s=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro', uri=True); d=sqlite3.connect(sys.argv[2]); s.backup(d); d.close(); s.close()" "$db_file" "$backup_file" \
    || sudo -n python3 -c "import sqlite3, sys; s=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro', uri=True); d=sqlite3.connect(sys.argv[2]); s.backup(d); d.close(); s.close()" "$db_file" "$backup_file"
  printf 'Verifying SQLite backup integrity and foreign keys...\n'
  python3 -c "import sqlite3, sys; con=sqlite3.connect(sys.argv[1]); res=con.execute('PRAGMA integrity_check').fetchone()[0]; fk=con.execute('PRAGMA foreign_key_check').fetchall(); con.close(); assert res == 'ok', f'Integrity check failed: {res}'; assert fk == [], f'Foreign key check failed: {fk}'" "$backup_file" \
    || sudo -n python3 -c "import sqlite3, sys; con=sqlite3.connect(sys.argv[1]); res=con.execute('PRAGMA integrity_check').fetchone()[0]; fk=con.execute('PRAGMA foreign_key_check').fetchall(); con.close(); assert res == 'ok', f'Integrity check failed: {res}'; assert fk == [], f'Foreign key check failed: {fk}'" "$backup_file"
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

cmd_verify() {
  local archive="$1"
  local sha="$2"
  if [[ ! -f "$archive" ]]; then
    printf 'Error: Archive not found: %s\n' "$archive" >&2
    return 1
  fi
  printf 'Verifying release archive %s for commit %s...\n' "$archive" "$sha"
  python3 "$ROOT_DIR/scripts/docker-candidate-release.py" verify "$archive" "$sha"
}

cmd_migrate() {
  local archive="$1"
  local sha="$2"
  local target_schema="$3"
  local deploy_dir="${4:-${OPERATOROS_DEPLOY_DIR:-/mnt/podman-data/operatoros/deploy}}"
  local data_dir="${OPERATOROS_DATA_DIR:-/mnt/podman-data/operatoros/data}"

  acquire_lock "$deploy_dir"
  local verify_json
  verify_json="$(cmd_verify "$archive" "$sha")"
  printf '%s\n' "$verify_json"

  local api_image
  api_image="$(python3 -c 'import json, sys; payload = sys.argv[1].split("\n", 1)[1] if sys.argv[1].startswith("Verifying ") else sys.argv[1]; d=json.loads(payload); print(d["manifest"]["api_image"]["reference"])' "$verify_json")"
  if [[ -z "$api_image" ]]; then
    printf 'Error: Could not resolve api_image reference from verified archive\n' >&2
    return 1
  fi

  local tmp_extract
  tmp_extract="/tmp/operatoros-migrate-extract-$$"
  trap 'rm -rf "$tmp_extract"' RETURN
  python3 "$ROOT_DIR/scripts/docker-candidate-release.py" extract "$archive" "$sha" "$tmp_extract" >/dev/null
  if [[ -f "$tmp_extract/docker-images.tar" ]]; then
    docker load -i "$tmp_extract/docker-images.tar" || sudo -n docker load -i "$tmp_extract/docker-images.tar"
  fi

  local compose_file=""
  compose_file="$(resolve_compose_file "$deploy_dir" "" || true)"
  if [[ -n "$compose_file" ]]; then
    printf 'Quiescing operatoros-api before forward migration...\n'
    $DOCKER_CMD -p operatoros -f "$compose_file" stop operatoros-api || sudo -n $DOCKER_CMD -p operatoros -f "$compose_file" stop operatoros-api || true
  fi

  backup_sqlite_hot "$data_dir" "pre_migrate_${target_schema}"

  printf 'Executing operational migration to %s using %s...\n' "$target_schema" "$api_image"
  if ! (docker run --rm --entrypoint bun --user 1000:1000 \
      -e OPERATOROS_OPERATIONAL_MIGRATION_WRAPPER=docker-deploy-v1 \
      -v "$data_dir:/var/lib/operatoros/data:rw" \
      "$api_image" \
      packages/db/src/db-cli.ts migrate-operational --data-dir /var/lib/operatoros/data --authorize-target "$target_schema" \
    || sudo -n docker run --rm --entrypoint bun --user 1000:1000 \
      -e OPERATOROS_OPERATIONAL_MIGRATION_WRAPPER=docker-deploy-v1 \
      -v "$data_dir:/var/lib/operatoros/data:rw" \
      "$api_image" \
      packages/db/src/db-cli.ts migrate-operational --data-dir /var/lib/operatoros/data --authorize-target "$target_schema"); then
    printf 'Error: Operational migration failed.\n' >&2
    if [[ -n "$compose_file" ]]; then
      printf 'Restarting previous operatoros-api container...\n' >&2
      $DOCKER_CMD -p operatoros -f "$compose_file" start operatoros-api || sudo -n $DOCKER_CMD -p operatoros -f "$compose_file" start operatoros-api || true
    fi
    return 1
  fi

  printf 'Validating migrated database against %s...\n' "$api_image"
  docker run --rm --entrypoint bun --user 1000:1000 \
    -v "$data_dir:/var/lib/operatoros/data:ro" \
    "$api_image" \
    packages/db/src/db-cli.ts validate --data-dir /var/lib/operatoros/data \
  || sudo -n docker run --rm --entrypoint bun --user 1000:1000 \
    -v "$data_dir:/var/lib/operatoros/data:ro" \
    "$api_image" \
    packages/db/src/db-cli.ts validate --data-dir /var/lib/operatoros/data
}

cmd_deploy() {
  local archive="$1"
  local sha="$2"
  local deploy_dir="${3:-${OPERATOROS_DEPLOY_DIR:-/mnt/podman-data/operatoros/deploy}}"
  local data_dir="${OPERATOROS_DATA_DIR:-/mnt/podman-data/operatoros/data}"
  local releases_dir="$deploy_dir/releases"
  local target_release="$releases_dir/$sha"
  local current_link="$deploy_dir/current"
  local prev_release=""

  acquire_lock "$deploy_dir"
  local verify_json
  verify_json="$(cmd_verify "$archive" "$sha")"
  printf '%s\n' "$verify_json"

  local api_image caddy_image
  api_image="$(python3 -c 'import json, sys; payload = sys.argv[1].split("\n", 1)[1] if sys.argv[1].startswith("Verifying ") else sys.argv[1]; d=json.loads(payload); print(d["manifest"]["api_image"]["reference"])' "$verify_json")"
  caddy_image="$(python3 -c 'import json, sys; payload = sys.argv[1].split("\n", 1)[1] if sys.argv[1].startswith("Verifying ") else sys.argv[1]; d=json.loads(payload); print(d["manifest"]["caddy_image"]["reference"])' "$verify_json")"

  backup_sqlite_hot "$data_dir" "predeploy"

  mkdir -p "$releases_dir"
  if [[ -L "$current_link" ]]; then
    prev_release="$(readlink -f "$current_link" || true)"
  fi

  printf 'Extracting release to %s...\n' "$target_release"
  rm -rf "$target_release"
  python3 "$ROOT_DIR/scripts/docker-candidate-release.py" extract "$archive" "$sha" "$target_release"

  # Load Docker images if included in archive
  for img in "$target_release"/*.tar; do
    if [[ -f "$img" && "$img" != "$archive" ]]; then
      printf 'Loading image %s into Docker...\n' "$(basename "$img")"
      docker load -i "$img" || sudo -n docker load -i "$img"
    fi
  done

  # Record target release schema version
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

  # Record previous release for rollback
  if [[ -n "$prev_release" && "$prev_release" != "$target_release" ]]; then
    printf '%s\n' "$prev_release" > "$deploy_dir/.previous_release"
    if [[ -f "$prev_release/.schema_version" ]]; then
      cp -f "$prev_release/.schema_version" "$deploy_dir/.previous_schema_version" || true
    fi
  fi

  # Atomic symlink switch
  ln -sfn "$target_release" "$current_link"

  # Ensure web release symlink if web directory exists
  if [[ -d "/mnt/podman-data/operatoros/web" ]]; then
    ln -sfn "$target_release" "/mnt/podman-data/operatoros/web/current" || sudo -n ln -sfn "$target_release" "/mnt/podman-data/operatoros/web/current"
  fi

  local compose_file=""
  compose_file="$(resolve_compose_file "$deploy_dir" "$target_release" || true)"
  if [[ -z "$compose_file" || ! -f "$compose_file" ]]; then
    printf 'Error: No docker-compose.yml found in %s, /home/mikhailryu/docker/operatoros, or %s\n' "$deploy_dir" "$target_release" >&2
    return 1
  fi

  if [[ "$compose_file" == "$deploy_dir/docker-compose.yml" ]]; then
    cp -f "$compose_file" "$deploy_dir/.previous_compose.yml"
    sync_compose_images "$compose_file" "$api_image" "$caddy_image"
  fi

  printf 'Applying Docker Compose configuration from %s (API=%s, Caddy=%s)...\n' "$compose_file" "$api_image" "$caddy_image"
  export OPERATOROS_API_IMAGE="$api_image"
  export OPERATOROS_CADDY_IMAGE="$caddy_image"
  export OPERATOROS_DEPLOY_DIR="$deploy_dir"
  export OPERATOROS_DATA_DIR="$data_dir"
  export OPERATOROS_WEB_ROOT="${OPERATOROS_WEB_ROOT:-/mnt/podman-data/operatoros/web/current/client}"
  $DOCKER_CMD -p operatoros -f "$compose_file" up -d --remove-orphans || sudo -n --preserve-env=OPERATOROS_API_IMAGE,OPERATOROS_CADDY_IMAGE,OPERATOROS_DEPLOY_DIR,OPERATOROS_DATA_DIR,OPERATOROS_WEB_ROOT $DOCKER_CMD -p operatoros -f "$compose_file" up -d --remove-orphans

  # Verify health
  printf 'Waiting for services to become healthy...\n'
  local healthy=0
  for i in $(seq 1 30); do
    if curl -sf --max-time 2 http://127.0.0.1:18088/health >/dev/null 2>&1 && \
       curl -sf --max-time 2 http://127.0.0.1:18090/health >/dev/null 2>&1; then
      healthy=1
      break
    fi
    sleep 2
  done

  if [[ "$healthy" -eq 1 ]]; then
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

  # Resolve compose file before modifying symlinks (DEP-02)
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

  # Verify database schema compatibility before modifying symlinks or restarting containers (DEP-01)
  if [[ -f "$ROOT_DIR/scripts/verify-rollback-schema.py" ]]; then
    python3 "$ROOT_DIR/scripts/verify-rollback-schema.py" "$data_dir" "$prev_release" "$deploy_dir" || \
      (command -v sudo >/dev/null 2>&1 && sudo -n python3 "$ROOT_DIR/scripts/verify-rollback-schema.py" "$data_dir" "$prev_release" "$deploy_dir")
  fi

  printf 'Rolling back to previous release: %s\n' "$prev_release"
  ln -sfn "$prev_release" "$current_link"

  if [[ -d "/mnt/podman-data/operatoros/web" ]]; then
    ln -sfn "$prev_release" "/mnt/podman-data/operatoros/web/current" || sudo -n ln -sfn "$prev_release" "/mnt/podman-data/operatoros/web/current"
  fi

  if [[ -f "$deploy_dir/.previous_compose.yml" && "$compose_file" == "$deploy_dir/docker-compose.yml" ]]; then
    cp -f "$deploy_dir/.previous_compose.yml" "$compose_file"
  fi

  printf 'Applying Docker Compose configuration from %s...\n' "$compose_file"
  $DOCKER_CMD -p operatoros -f "$compose_file" up -d --remove-orphans || sudo -n $DOCKER_CMD -p operatoros -f "$compose_file" up -d --remove-orphans
  printf 'Rollback complete. Checking health...\n'
  sleep 3
  curl -sf http://127.0.0.1:18088/health || sudo -n curl -sf http://127.0.0.1:18088/health
}

cmd_status() {
  local deploy_dir="${1:-${OPERATOROS_DEPLOY_DIR:-/mnt/podman-data/operatoros/deploy}}"
  local fallback_compose="${OPERATOROS_COMPOSE_FALLBACK_FILE:-/home/mikhailryu/docker/operatoros/docker-compose.yml}"
  local compose_file=""
  if [[ -f "$deploy_dir/docker-compose.yml" ]]; then
    compose_file="$deploy_dir/docker-compose.yml"
  elif [[ -f "$fallback_compose" ]]; then
    compose_file="$fallback_compose"
  elif [[ -f "$deploy_dir/current/deploy/docker/docker-compose.yml" ]]; then
    compose_file="$deploy_dir/current/deploy/docker/docker-compose.yml"
  fi
  if [[ -z "$compose_file" || ! -f "$compose_file" ]]; then
    printf 'Error: No docker-compose.yml found for status\n' >&2
    return 1
  fi
  $DOCKER_CMD -p operatoros -f "$compose_file" ps || sudo -n $DOCKER_CMD -p operatoros -f "$compose_file" ps
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

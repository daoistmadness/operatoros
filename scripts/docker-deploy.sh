#!/usr/bin/env bash
# OperatorOS Canonical Docker Compose Deployment and Rollback
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  cat <<'EOF'
Usage:
  scripts/docker-deploy.sh verify <candidate-archive.tar> <source-sha>
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
  mkdir -p "$deploy_dir" || sudo -n mkdir -p "$deploy_dir"
  local lock_file="$deploy_dir/.deploy.lock"
  exec 200>"$lock_file"
  if ! flock -n 200; then
    printf 'Error: Concurrent deployment or rollback in progress (lock held on %s)\n' "$lock_file" >&2
    return 1
  fi
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
  cmd_verify "$archive" "$sha"

  # Pre-deployment hot SQLite backup with integrity verification
  if [[ -f "$data_dir/operatoros.sqlite" ]]; then
    local backup_dir="$data_dir/backups"
    mkdir -p "$backup_dir" || sudo -n mkdir -p "$backup_dir"
    local backup_file="$backup_dir/predeploy_$(date -u +%Y-%m-%dT%H-%M-%SZ).sqlite3"
    printf 'Creating pre-deployment SQLite backup at %s...\n' "$backup_file"
    python3 -c "import sqlite3, sys; s=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro', uri=True); d=sqlite3.connect(sys.argv[2]); s.backup(d); d.close(); s.close()" "$data_dir/operatoros.sqlite" "$backup_file" || sudo -n python3 -c "import sqlite3, sys; s=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro', uri=True); d=sqlite3.connect(sys.argv[2]); s.backup(d); d.close(); s.close()" "$data_dir/operatoros.sqlite" "$backup_file"
    printf 'Verifying pre-deployment SQLite backup integrity...\n'
    python3 -c "import sqlite3, sys; con=sqlite3.connect(sys.argv[1]); res=con.execute('PRAGMA integrity_check').fetchone()[0]; con.close(); assert res == 'ok', f'Integrity check failed: {res}'" "$backup_file" || sudo -n python3 -c "import sqlite3, sys; con=sqlite3.connect(sys.argv[1]); res=con.execute('PRAGMA integrity_check').fetchone()[0]; con.close(); assert res == 'ok', f'Integrity check failed: {res}'" "$backup_file"
  fi

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

  # Record previous release for rollback
  if [[ -n "$prev_release" && "$prev_release" != "$target_release" ]]; then
    printf '%s\n' "$prev_release" > "$deploy_dir/.previous_release"
  fi

  # Atomic symlink switch
  ln -sfn "$target_release" "$current_link"

  # Ensure web release symlink if web directory exists
  if [[ -d "/mnt/podman-data/operatoros/web" ]]; then
    ln -sfn "$target_release" "/mnt/podman-data/operatoros/web/current" || sudo -n ln -sfn "$target_release" "/mnt/podman-data/operatoros/web/current"
  fi

  # Find compose file
  local compose_file=""
  if [[ -f "$deploy_dir/docker-compose.yml" ]]; then
    compose_file="$deploy_dir/docker-compose.yml"
  elif [[ -f "/home/mikhailryu/docker/operatoros/docker-compose.yml" ]]; then
    compose_file="/home/mikhailryu/docker/operatoros/docker-compose.yml"
  elif [[ -f "$target_release/deploy/docker/docker-compose.yml" ]]; then
    compose_file="$target_release/deploy/docker/docker-compose.yml"
  fi

  if [[ -z "$compose_file" || ! -f "$compose_file" ]]; then
    printf 'Error: No docker-compose.yml found in %s, /home/mikhailryu/docker/operatoros, or %s\n' "$deploy_dir" "$target_release" >&2
    return 1
  fi

  printf 'Applying Docker Compose configuration from %s...\n' "$compose_file"
  $DOCKER_CMD -p operatoros -f "$compose_file" up -d --remove-orphans || sudo -n $DOCKER_CMD -p operatoros -f "$compose_file" up -d --remove-orphans

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

  printf 'Rolling back to previous release: %s\n' "$prev_release"
  ln -sfn "$prev_release" "$current_link"

  if [[ -d "/mnt/podman-data/operatoros/web" ]]; then
    ln -sfn "$prev_release" "/mnt/podman-data/operatoros/web/current" || sudo -n ln -sfn "$prev_release" "/mnt/podman-data/operatoros/web/current"
  fi

  local compose_file=""
  if [[ -f "$deploy_dir/docker-compose.yml" ]]; then
    compose_file="$deploy_dir/docker-compose.yml"
  elif [[ -f "/home/mikhailryu/docker/operatoros/docker-compose.yml" ]]; then
    compose_file="/home/mikhailryu/docker/operatoros/docker-compose.yml"
  fi

  if [[ -z "$compose_file" || ! -f "$compose_file" ]]; then
    printf 'Error: No docker-compose.yml found for rollback\n' >&2
    return 1
  fi

  $DOCKER_CMD -p operatoros -f "$compose_file" up -d --remove-orphans || sudo -n $DOCKER_CMD -p operatoros -f "$compose_file" up -d --remove-orphans
  printf 'Rollback complete. Checking health...\n'
  sleep 3
  curl -sf http://127.0.0.1:18088/health || sudo -n curl -sf http://127.0.0.1:18088/health
}

cmd_status() {
  local deploy_dir="${1:-${OPERATOROS_DEPLOY_DIR:-/mnt/podman-data/operatoros/deploy}}"
  local compose_file=""
  if [[ -f "$deploy_dir/docker-compose.yml" ]]; then
    compose_file="$deploy_dir/docker-compose.yml"
  elif [[ -f "/home/mikhailryu/docker/operatoros/docker-compose.yml" ]]; then
    compose_file="/home/mikhailryu/docker/operatoros/docker-compose.yml"
  fi
  if [[ -z "$compose_file" || ! -f "$compose_file" ]]; then
    printf 'Error: No docker-compose.yml found for status\n' >&2
    return 1
  fi
  $DOCKER_CMD -p operatoros -f "$compose_file" ps || sudo -n $DOCKER_CMD -p operatoros -f "$compose_file" ps
}

case "${1:-}" in
  verify)
    [[ $# -ge 3 ]] || usage
    cmd_verify "$2" "$3"
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

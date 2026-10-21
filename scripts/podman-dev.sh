#!/usr/bin/env bash

set -Eeuo pipefail

PROJECT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
IMAGE="localhost/operatoros-podman-dev:local"
CONTAINER="operatoros-podman-dev"
DATA_VOLUME="operatoros-podman-dev-data"
RUNTIME_VOLUME="operatoros-podman-dev-runtime"
HOST_PORT="${OPERATOROS_PODMAN_PORT:-5174}"
interactive_args=()

fail() { printf 'Podman development: %s\n' "$1" >&2; exit 2; }

[[ "$(uname -s)" == Linux ]] || fail "Linux with rootless Podman is required."
command -v podman >/dev/null 2>&1 || fail "Install Podman first."
command -v sha256sum >/dev/null 2>&1 || fail "sha256sum is required."
[[ "$HOST_PORT" =~ ^[0-9]{1,5}$ ]] || fail "OPERATOROS_PODMAN_PORT must be a port from 1024 to 65535."
HOST_PORT="$((10#$HOST_PORT))"
(( HOST_PORT >= 1024 && HOST_PORT <= 65535 )) || fail "OPERATOROS_PODMAN_PORT must be a port from 1024 to 65535."
if [[ -t 0 && -t 1 ]]; then interactive_args+=(--interactive --tty); fi
[[ "$(podman info --format '{{.Host.Security.Rootless}}' 2>/dev/null)" == true ]] || fail "Rootless Podman is required."
podman container exists "$CONTAINER" && fail "Container $CONTAINER already exists; inspect it before removing it."

dependency_key="$({
  sha256sum Containerfile.podman package.json bun.lock
  find apps packages -mindepth 2 -maxdepth 2 -name package.json -print0 | sort -z | xargs -0 sha256sum
} | sha256sum | cut -c1-12)"
[[ "$dependency_key" =~ ^[a-f0-9]{12}$ ]] || fail "Could not determine the workspace dependency version."

ensure_volume() {
  local name="$1" purpose="$2" label
  if podman volume exists "$name"; then
    label="$(podman volume inspect --format '{{ index .Labels "io.operatoros.dev" }}:{{ index .Labels "io.operatoros.purpose" }}' "$name")"
    [[ "$label" == "podman-dev:$purpose" ]] || fail "Volume $name exists without this setup's ownership labels; inspect it before proceeding."
  else
    podman volume create --label io.operatoros.dev=podman-dev --label "io.operatoros.purpose=$purpose" "$name" >/dev/null
  fi
}

ensure_volume "$DATA_VOLUME" data
ensure_volume "$RUNTIME_VOLUME" runtime

workspace_node_modules=(
  node_modules
  apps/api/node_modules
  apps/web/node_modules
  packages/contracts/node_modules
  packages/db/node_modules
  packages/excel/node_modules
  packages/ui/node_modules
)
seed_mounts=()
runtime_mounts=()
index=0
for workspace in "${workspace_node_modules[@]}"; do
  index=$((index + 1))
  purpose="dependencies-${workspace//\//-}"
  volume="operatoros-podman-dev-deps-${dependency_key}-${index}"
  ensure_volume "$volume" "$purpose"
  seed_mounts+=(--volume "$volume:/workspace/$workspace")
  runtime_mounts+=(--volume "$volume:$PROJECT_ROOT/$workspace:rw")
done

podman build --file "$PROJECT_ROOT/Containerfile.podman" --tag "$IMAGE" "$PROJECT_ROOT"
# Seed dependency volumes from the locked image before the read-only source bind hides it.
podman run --rm --user 0:0 "${seed_mounts[@]}" --entrypoint /bin/true "$IMAGE"

GIT_COMMON_DIR="$(git -C "$PROJECT_ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || fail "Run this from an OperatorOS Git worktree."
SESSION_REGISTRY="$GIT_COMMON_DIR/operatoros-dev-sessions"
[[ -d "$SESSION_REGISTRY" ]] || mkdir -m 700 -- "$SESSION_REGISTRY"
[[ ! -L "$SESSION_REGISTRY" ]] || fail "The Git session registry is a symlink; refusing to mount it."

masked_directories=()
for directory in .runtime backend data backups logs; do
  [[ -d "$PROJECT_ROOT/$directory" ]] && masked_directories+=(--tmpfs "$PROJECT_ROOT/$directory:rw,noexec,nosuid,nodev,size=16m")
done

printf 'Starting rootless Podman development at http://127.0.0.1:%s\n' "$HOST_PORT"
printf 'Development data persists in Podman volume %s. Press Ctrl+C to stop; the volume is retained.\n\n' "$DATA_VOLUME"
exec podman run --rm --init --name "$CONTAINER" --workdir "$PROJECT_ROOT" --stop-timeout 45 \
  --user 0:0 --cap-drop=all --security-opt=no-new-privileges \
  "${interactive_args[@]}" \
  --publish "127.0.0.1:$HOST_PORT:5173" \
  --volume "$PROJECT_ROOT:$PROJECT_ROOT:ro" \
  --volume "$GIT_COMMON_DIR:$GIT_COMMON_DIR:ro" \
  --volume "$SESSION_REGISTRY:$SESSION_REGISTRY:rw" \
  --volume "$DATA_VOLUME:/var/lib/operatoros:rw" \
  --volume "$RUNTIME_VOLUME:/var/lib/operatoros-runtime:rw" \
  "${runtime_mounts[@]}" "${masked_directories[@]}" \
  --env OPERATOROS_PRIMARY_CHECKOUT_PATH=/__operatoros_primary_checkout \
  --env OPERATOROS_DATA_DIR=/var/lib/operatoros \
  --env OPERATOROS_RUNTIME_DIR=/var/lib/operatoros-runtime/operatoros-dev \
  --env OPERATOROS_DISABLE_ENV_FILES=true \
  --env BUN_OPTIONS=--no-env-file \
  --env BACKEND_HOST=127.0.0.1 --env BACKEND_PORT=8000 \
  --env FRONTEND_HOST=0.0.0.0 --env FRONTEND_PORT=5173 \
  --env "ALLOWED_ORIGINS=http://localhost:$HOST_PORT,http://127.0.0.1:$HOST_PORT" \
  --env COOKIE_SECURE=false \
  --env VITE_HMR_HOST=127.0.0.1 --env VITE_HMR_PROTOCOL=ws --env "VITE_HMR_CLIENT_PORT=$HOST_PORT" \
  "$IMAGE"

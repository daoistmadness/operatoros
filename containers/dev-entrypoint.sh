#!/bin/sh
set -eu

project_root=/workspace/operatoros
dependency_lock="$(sha256sum /workspace/bun.lock | cut -d ' ' -f 1)"
source_lock="$(sha256sum "$project_root/bun.lock" | cut -d ' ' -f 1)"
if [ "$dependency_lock" != "$source_lock" ]; then
  echo 'Development image dependencies do not match the mounted source lockfile; rebuild the Quadlet image.' >&2
  exit 1
fi
if [ -z "${OPERATOROS_DEV_DEPENDENCY_LAYOUT:-}" ]; then
  echo 'Development dependency layout is missing from the image.' >&2
  exit 1
fi
image_lock="$(printf '%s\n%s\n' "$dependency_lock" "$OPERATOROS_DEV_DEPENDENCY_LAYOUT" | sha256sum | cut -d ' ' -f 1)"
cd "$project_root"

for workspace in apps/api apps/web packages/contracts packages/db packages/excel packages/ui; do
  workspace_modules="$project_root/$workspace/node_modules"
  if [ -e "$workspace_modules" ] || [ -L "$workspace_modules" ]; then
    echo "Host-generated workspace dependencies exist at $workspace/node_modules; use a clean container source checkout so the image-owned hoisted dependencies remain authoritative." >&2
    exit 1
  fi
done

case "${1:-}" in
  api)
    if [ ! -f node_modules/.operatoros-image-lock ] \
      || [ "$(cat node_modules/.operatoros-image-lock)" != "$image_lock" ]; then
      cp -R /workspace/operatoros-dependencies/node_modules/. node_modules/
      printf '%s\n' "$image_lock" > node_modules/.operatoros-image-lock
    fi
    if [ ! -f "$OPERATOROS_DATA_DIR/operatoros.sqlite" ]; then
      if [ "${OPERATOROS_DEV_BOOTSTRAP:-false}" != true ]; then
        echo 'The configured development database is missing; refusing implicit bootstrap. Set OPERATOROS_DEV_BOOTSTRAP=true only for an explicitly disposable data root.' >&2
        exit 1
      fi
      bun --no-env-file run db:bootstrap --data-dir "$OPERATOROS_DATA_DIR"
    fi
    exec bun --no-env-file run apps/api/src/server.ts
    ;;
  web)
    ready=0
    attempt=0
    while [ "$attempt" -lt 45 ]; do
      if [ -f node_modules/.operatoros-image-lock ] \
        && [ "$(cat node_modules/.operatoros-image-lock)" = "$image_lock" ]; then
        ready=1
        break
      fi
      attempt=$((attempt + 1))
      sleep 1
    done
    if [ "$ready" != 1 ]; then
      echo 'API did not seed matching development dependencies before the readiness deadline.' >&2
      exit 1
    fi
    cd apps/web
    exec bun --no-env-file ../../node_modules/vite/bin/vite.js --host "$FRONTEND_HOST" --port "$FRONTEND_PORT" --strictPort
    ;;
  *)
    echo 'Usage: operatoros-dev-entrypoint {api|web}' >&2
    exit 2
    ;;
esac

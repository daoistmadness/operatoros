#!/bin/sh
set -eu

project_root=/workspace/operatoros
image_lock="$(sha256sum /workspace/bun.lock | cut -d ' ' -f 1)"
source_lock="$(sha256sum "$project_root/bun.lock" | cut -d ' ' -f 1)"
if [ "$image_lock" != "$source_lock" ]; then
  echo 'Development image dependencies do not match the mounted source lockfile; rebuild the Quadlet image.' >&2
  exit 1
fi
cd "$project_root"

case "${1:-}" in
  api)
    if [ ! -f node_modules/.operatoros-image-lock ] \
      || [ "$(cat node_modules/.operatoros-image-lock)" != "$image_lock" ]; then
      cp -R --no-preserve=ownership /workspace/node_modules/. node_modules/
      printf '%s\n' "$image_lock" > node_modules/.operatoros-image-lock
    fi
    if [ ! -f "$OPERATOROS_DATA_DIR/operatoros.sqlite" ]; then
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
    exec bun --no-env-file ./node_modules/vite/bin/vite.js --host "$FRONTEND_HOST" --port "$FRONTEND_PORT" --strictPort
    ;;
  *)
    echo 'Usage: operatoros-dev-entrypoint {api|web}' >&2
    exit 2
    ;;
esac

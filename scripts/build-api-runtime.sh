#!/bin/sh
set -eu

if [ "$#" -ne 1 ] || [ -z "$1" ]; then
  echo "Usage: build-api-runtime.sh <output-directory>" >&2
  exit 2
fi

output_dir=$1
case "$output_dir" in
  /*) ;;
  *) output_dir="$(pwd)/$output_dir" ;;
esac
mkdir -p "$output_dir/cli" "$output_dir/domains" "$output_dir/import"

build() {
  bun build "$1" \
    --target=node \
    --packages=bundle \
    --external=better-sqlite3 \
    --external=@node-rs/argon2 \
    --outfile="$output_dir/$2"
}

build apps/api/src/server.ts server.mjs
build apps/api/src/backup-cli.ts backup-cli.mjs
build apps/api/src/backup-cli-runner.ts backup-cli-runner.mjs
build apps/api/src/cli/admin-recovery.ts cli/admin-recovery.mjs
build packages/db/src/db-cli.ts db-cli.mjs
build apps/api/src/import/excel-reader.worker.ts import/excel-reader.worker.mjs
build apps/api/src/domains/backup-operation-lock-holder.ts domains/backup-operation-lock-holder.mjs
cp packages/db/src/*.sql "$output_dir/"

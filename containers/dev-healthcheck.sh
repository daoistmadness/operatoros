#!/bin/sh
set -eu

case "${1:-}" in
  api) url=http://127.0.0.1:8090/ready ;;
  web) url=http://127.0.0.1:5173/ ;;
  *) exit 2 ;;
esac

bun -e "fetch('$url').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

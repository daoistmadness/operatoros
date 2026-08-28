#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
bun "$PROJECT_ROOT/apps/api/src/backup-cli.ts" backup "$@"

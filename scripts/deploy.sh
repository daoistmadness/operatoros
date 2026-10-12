#!/usr/bin/env bash
set -Eeuo pipefail

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

blocked() { printf 'BLOCKED: %s\n' "$1" >&2; exit 2; }
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
check_local() {
  command -v podman >/dev/null || fail 'Podman is required for the OCI deployment path'
  [ "$(podman info --format '{{.Host.Security.Rootless}}')" = true ] || fail 'Deployment verification must run rootless'
  [ "$(bun packages/db/src/schema-version-cli.ts --format current)" = 20261002_s48 ] || fail 'Canonical schema head is not S4.8'
}
read_manifest() {
  manifest="${OPERATOROS_RELEASE_MANIFEST:-}"
  [ -n "$manifest" ] && [ -f "$manifest" ] || blocked 'Set OPERATOROS_RELEASE_MANIFEST to the approved CI release manifest'
  command -v jq >/dev/null || fail 'jq is required to validate the release manifest'
  [ "$(jq -er '.schema' "$manifest")" = 20261002_s48 ] || fail 'Release manifest does not target canonical S4.8'
  commit="$(jq -er '.sourceCommit' "$manifest")"
  [[ "$commit" =~ ^[a-f0-9]{40}$ ]] || fail 'Release manifest sourceCommit must be a full Git commit SHA'
  api="$(jq -er '.images.api' "$manifest")"
  web="$(jq -er '.images.web' "$manifest")"
  [[ "$api" =~ ^ghcr\.io/daoistmadness/operatoros-api@sha256:[a-f0-9]{64}$ ]] || fail 'API release reference must use the approved GHCR name and immutable digest'
  [[ "$web" =~ ^ghcr\.io/daoistmadness/operatoros-web@sha256:[a-f0-9]{64}$ ]] || fail 'web release reference must use the approved GHCR name and immutable digest'
}

case "${1:-}" in
  check)
    check_local
    printf 'PASS: rootless Podman and canonical S4.8 deployment validation prerequisites\n'
    printf 'BLOCKED: remote deployment requires a reviewed host-infrastructure change and explicit staging target\n'
    ;;
  plan)
    check_local
    environment="${OPERATOROS_DEPLOY_ENV:-}"
    [[ "$environment" == staging || "$environment" == production ]] || blocked 'Set OPERATOROS_DEPLOY_ENV explicitly to staging or production'
    read_manifest
    [ -n "${OPERATOROS_DEPLOY_HOST:-}" ] || blocked 'Set OPERATOROS_DEPLOY_HOST from the approved environment configuration'
    printf 'PASS: %s plan validated for source %s\nAPI %s\nWeb %s\n' "$environment" "$commit" "$api" "$web"
    printf 'BLOCKED: no staging host adapter is configured in this worktree; no remote mutation is available\n'
    ;;
  apply)
    check_local
    [[ "${OPERATOROS_DEPLOY_ENV:-}" == staging || "${OPERATOROS_DEPLOY_ENV:-}" == production ]] \
      || blocked 'Set OPERATOROS_DEPLOY_ENV explicitly to staging or production'
    read_manifest
    [ -n "${OPERATOROS_DEPLOY_HOST:-}" ] || blocked 'Set OPERATOROS_DEPLOY_HOST from the approved environment configuration'
    blocked 'Remote apply is unavailable until the host-infrastructure owner approves an adapter and target; live host files were not modified'
    ;;
  verify)
    check_local
    bash scripts/podman-ci.sh smoke
    ;;
  rollback)
    check_local
    bash scripts/podman-rollback-smoke.sh
    ;;
  *) echo 'Usage: scripts/deploy.sh {check|plan|apply|verify|rollback}' >&2; exit 2 ;;
esac

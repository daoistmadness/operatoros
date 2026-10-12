#!/usr/bin/env bash
set -Eeuo pipefail

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
source_dir="$root/containers/quadlet/dev"
config_home="${XDG_CONFIG_HOME:-$HOME/.config}"
target_dir="$config_home/containers/systemd"
generator=/usr/lib/systemd/user-generators/podman-user-generator
units=(operatoros-dev.build operatoros-dev.pod operatoros-dev-data.volume operatoros-dev-node-modules.volume operatoros-dev.container operatoros-dev-web.container)
services=(operatoros-dev-pod.service operatoros-dev.service operatoros-dev-web.service)

fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
require_systemd_user() {
  systemctl --user show-environment >/dev/null 2>&1 || fail 'systemd user manager is unavailable'
}
check_units() {
  command -v podman >/dev/null || fail 'Podman is unavailable'
  [ -x "$generator" ] || fail 'installed Podman Quadlet user generator is unavailable'
  [ "$(podman info --format '{{.Host.Security.Rootless}}')" = true ] || fail 'Podman must be rootless'
  local temp
  temp="$(mktemp -d)"
  trap 'rm -rf -- "$temp"; trap - RETURN' RETURN
  mkdir -p "$temp/early" "$temp/normal" "$temp/late"
  QUADLET_UNIT_DIRS="$source_dir" "$generator" -user "$temp/early" "$temp/normal" "$temp/late"
  shopt -s nullglob
  local generated=("$temp/early"/*.service "$temp/normal"/*.service "$temp/late"/*.service)
  [ -e "${generated[0]}" ] || fail 'Quadlet generated no systemd units'
  systemd-analyze --user verify "${generated[@]}"
  grep -Fq 'Requires=operatoros-dev-build.service' "$temp/early/operatoros-dev.service" || fail 'API does not depend on its Quadlet build unit'
  grep -Fq 'Requires=operatoros-dev-build.service' "$temp/early/operatoros-dev-web.service" || fail 'web does not depend on its Quadlet build unit'
  grep -Fq 'BindsTo=operatoros-dev-pod.service' "$temp/early/operatoros-dev.service" || fail 'API does not bind to its Pod unit'
  grep -Fq 'BindsTo=operatoros-dev-pod.service' "$temp/early/operatoros-dev-web.service" || fail 'web does not bind to its Pod unit'
  grep -Fq -- '--publish 127.0.0.1:5173:5173' "$temp/early/operatoros-dev-pod.service" || fail 'Pod does not publish Vite on loopback only'
  grep -Fq -- '--network slirp4netns' "$temp/early/operatoros-dev-pod.service" || fail 'Pod rootless network backend is not explicit'
  grep -Fq 'Notify=healthy' "$temp/early/operatoros-dev.service" || fail 'API startup is not health-aware'
  grep -Fq 'Notify=healthy' "$temp/early/operatoros-dev-web.service" || fail 'web startup is not health-aware'
  ! grep -Eq 'start-dev\.sh|PRIMARY_CHECKOUT_UNEXPECTED_BRANCH' "$source_dir"/*.container || fail 'persistent Quadlet references the mutable-checkout launcher'
  printf 'PASS: Quadlet source generated and verified with Podman %s\n' "$(podman --version | awk '{print $3}')"
}
plan_install() {
  check_units
  local changed=0
  for file in "${units[@]}"; do
    if [ -e "$target_dir/$file" ]; then
      if ! cmp -s "$source_dir/$file" "$target_dir/$file"; then
        diff -u --label "installed/$file" --label "repository/$file" "$target_dir/$file" "$source_dir/$file" || [ "$?" = 1 ]
        changed=1
      fi
    else
      diff -u --label "/dev/null" --label "repository/$file" /dev/null "$source_dir/$file" || [ "$?" = 1 ]
      changed=1
    fi
  done
  [ "$changed" = 1 ] || printf 'Quadlet definitions already match %s\n' "$target_dir"
}
service_exists() {
  systemctl --user cat "$1" >/dev/null 2>&1 || fail "$1 is not installed; inspect mise run podman:quadlet:plan first"
}
ensure_exclusive_frontend() {
  if podman container exists operatoros-dev; then
    fail 'legacy branch-sensitive operatoros-dev container exists; inspect it through its owner before selecting containerized development'
  fi
  if ! systemctl --user is-active --quiet operatoros-dev-web.service && ss -H -ltn 'sport = :5173' | grep -q .; then
    fail 'port 5173 is already owned; native and containerized development cannot run together'
  fi
}
up() {
  require_systemd_user
  for unit in "${services[@]}"; do service_exists "$unit"; done
  ensure_exclusive_frontend
  systemctl --user start operatoros-dev.service
  systemctl --user start operatoros-dev-web.service
}

case "${1:-}" in
  check) check_units ;;
  plan) plan_install ;;
  install)
    [ "${2:-}" = --apply ] || fail 'installation requires the explicit argument: install --apply'
    plan_install
    mkdir -p "$target_dir"
    backup_root="${XDG_STATE_HOME:-$HOME/.local/state}/operatoros/quadlet-backups/$(date -u +%Y%m%dT%H%M%SZ)"
    for file in "${units[@]}"; do
      if [ -e "$target_dir/$file" ] && ! cmp -s "$source_dir/$file" "$target_dir/$file"; then
        install -D -m 0600 "$target_dir/$file" "$backup_root/$file"
      fi
      install -D -m 0644 "$source_dir/$file" "$target_dir/$file"
    done
    systemctl --user daemon-reload
    printf 'Installed source-controlled OperatorOS Quadlets. Previous differing definitions: %s\n' "$backup_root"
    ;;
  up) up ;;
  down)
    require_systemd_user
    for unit in "${services[@]}"; do service_exists "$unit"; done
    systemctl --user stop operatoros-dev-web.service operatoros-dev.service operatoros-dev-pod.service
    ;;
  restart)
    require_systemd_user
    for unit in "${services[@]}"; do service_exists "$unit"; done
    systemctl --user stop operatoros-dev-web.service operatoros-dev.service operatoros-dev-pod.service
    up
    ;;
  rebuild)
    require_systemd_user
    for unit in "${services[@]}" operatoros-dev-build.service; do service_exists "$unit"; done
    systemctl --user stop operatoros-dev-web.service operatoros-dev.service
    systemctl --user restart operatoros-dev-build.service
    up
    ;;
  status)
    require_systemd_user
    systemctl --user --no-pager status "${services[@]}"
    ;;
  logs)
    require_systemd_user
    journalctl --user --follow --unit=operatoros-dev.service --unit=operatoros-dev-web.service --no-pager \
      | sed -E -e 's/((AUTH_COOKIE_SECRET|BACKUP_ENCRYPTION_KEY|ASTRYX_SETUP_TOKEN|DATABASE_URL|DATABASE_PATH)=)[^[:space:]]+/\1[REDACTED]/g' -e 's/(Bearer )[A-Za-z0-9._~+\/-]+=*/\1[REDACTED]/g'
    ;;
  *) echo 'Usage: scripts/podman-quadlet.sh {check|plan|install --apply|up|down|restart|rebuild|status|logs}' >&2; exit 2 ;;
esac

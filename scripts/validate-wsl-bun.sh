#!/usr/bin/env bash

# Sourceable, repository-scoped validation for the WSL Bun toolchain.
# This file intentionally does not install or download any runtime.

OPERATOROS_BUN_PATH=""
OPERATOROS_BUN_COMMAND=""
OPERATOROS_BUN_REALPATH=""
OPERATOROS_BUN_VERSION=""
OPERATOROS_WSL_TOOLCHAIN_REASON=""
OPERATOROS_WSL_TOOLCHAIN_ERROR=""
OPERATOROS_WSL_TOOLCHAIN_VERSION_CHECKS="not-run"
OPERATOROS_WSL_TOOLCHAIN_STATE="UNKNOWN"
OPERATOROS_BUN_BIN=""

operatoros_wsl_path_is_rejected() {
  local candidate="${1:-}"
  local lowered="${candidate,,}"

  [[ "$lowered" == //* ]] && return 0
  [[ "$lowered" == *wsl.localhost* || "$lowered" == *'wsl$'* ]] && return 0
  [[ "$lowered" =~ ^[a-z]:[/\\] ]] && return 0
  [[ "$lowered" == \\\\* ]] && return 0
  [[ "$lowered" =~ ^/mnt/[a-z]/ ]] && return 0
  [[ "$lowered" =~ /run/desktop/mnt/host/[a-z]/ ]] && return 0
  [[ "$lowered" == *windowsapps* ]] && return 0
  [[ "$lowered" == *"program files"* ]] && return 0
  [[ "$lowered" == *nvm4w* ]] && return 0
  [[ "$lowered" == *.exe || "$lowered" == *.cmd || "$lowered" == *.bat ]] && return 0
  return 1
}

operatoros_wsl_resolve_bun_paths() {
  OPERATOROS_BUN_COMMAND="$(command -v bun 2>/dev/null || true)"
  OPERATOROS_BUN_PATH="$(type -P bun 2>/dev/null || true)"
  OPERATOROS_BUN_REALPATH=""
  [[ -n "$OPERATOROS_BUN_PATH" ]] && OPERATOROS_BUN_REALPATH="$(readlink -f -- "$OPERATOROS_BUN_PATH" 2>/dev/null || true)"
}

operatoros_wsl_bun_is_safe() {
  local candidate
  for candidate in "$OPERATOROS_BUN_COMMAND" "$OPERATOROS_BUN_PATH" "$OPERATOROS_BUN_REALPATH"; do
    [[ -n "$candidate" ]] || continue
    if operatoros_wsl_path_is_rejected "$candidate"; then
      OPERATOROS_WSL_TOOLCHAIN_REASON="a resolved executable points to a Windows runtime"
      OPERATOROS_WSL_TOOLCHAIN_STATE="UNSAFE_PATH"
      return 1
    fi
  done

  if [[ -z "$OPERATOROS_BUN_PATH" || -z "$OPERATOROS_BUN_REALPATH" || ! -x "$OPERATOROS_BUN_REALPATH" ]]; then
    OPERATOROS_WSL_TOOLCHAIN_REASON="Linux Bun was not found or is not executable"
    OPERATOROS_WSL_TOOLCHAIN_STATE="MISSING"
    return 1
  fi
  return 0
}

operatoros_wsl_read_package_engine() {
  local package_json="${1:?package.json is required}"
  local field="${2:?engine field is required}"
  sed -nE "s/^[[:space:]]*\"${field}\"[[:space:]]*:[[:space:]]*\"([^\"]+)\".*/\1/p" "$package_json" 2>/dev/null | head -n1
}

operatoros_wsl_validate_bun() {
  local project_root="${1:?repository root is required}"
  local resolved_root
  OPERATOROS_BUN_VERSION=""
  OPERATOROS_WSL_TOOLCHAIN_VERSION_CHECKS="not-run"
  OPERATOROS_WSL_TOOLCHAIN_STATE="UNKNOWN"
  resolved_root="$(readlink -f -- "$project_root" 2>/dev/null || true)"
  if [[ "$(uname -s 2>/dev/null || true)" != Linux ]]; then
    OPERATOROS_WSL_TOOLCHAIN_REASON="the launcher is not running under a Linux WSL kernel"
    return 1
  fi
  if [[ "$resolved_root" != /home/* && "$resolved_root" != /home ]]; then
    OPERATOROS_WSL_TOOLCHAIN_REASON="the repository must be located under /home/ inside WSL"
    return 1
  fi

  OPERATOROS_WSL_TOOLCHAIN_REASON=""
  operatoros_wsl_resolve_bun_paths
  operatoros_wsl_bun_is_safe || return 1

  OPERATOROS_WSL_TOOLCHAIN_VERSION_CHECKS="executed"
  local bun_version
  bun_version="$("$OPERATOROS_BUN_PATH" --version 2>/dev/null || true)"
  if [[ ! "$bun_version" =~ ^([0-9]+)\.([0-9]+) ]]; then
    OPERATOROS_WSL_TOOLCHAIN_REASON="Bun did not return a usable semantic version"
    OPERATOROS_WSL_TOOLCHAIN_STATE="SAFE_WRONG_VERSION"
    return 1
  fi

  local major="${BASH_REMATCH[1]}"
  local minor="${BASH_REMATCH[2]}"
  if (( major != 1 || minor != 4 )); then
    OPERATOROS_WSL_TOOLCHAIN_REASON="Bun version must be 1.4.x; detected ${bun_version}"
    OPERATOROS_WSL_TOOLCHAIN_STATE="SAFE_WRONG_VERSION"
    return 1
  fi

  if [[ ! -f "$project_root/bun.lock" ]]; then
    OPERATOROS_WSL_TOOLCHAIN_REASON="root bun.lock is missing; it is the sole authority"
    OPERATOROS_WSL_TOOLCHAIN_STATE="MISSING_LOCKFILE"
    return 1
  fi

  if [[ -f "$project_root/package-lock.json" || -f "$project_root/apps/api/package-lock.json" || -f "$project_root/frontend/package-lock.json" ]]; then
    OPERATOROS_WSL_TOOLCHAIN_REASON="package-lock.json must not exist; root bun.lock is the sole authority"
    OPERATOROS_WSL_TOOLCHAIN_STATE="OBSOLETE_LOCKFILE"
    return 1
  fi

  OPERATOROS_BUN_VERSION="$bun_version"
  OPERATOROS_WSL_TOOLCHAIN_STATE="SAFE_CORRECT"
  return 0
}

operatoros_wsl_toolchain_failure() {
  local bun_display="${OPERATOROS_BUN_PATH:-<not found>}"
  local bun_resolved="${OPERATOROS_BUN_REALPATH:-<unresolved>}"

  OPERATOROS_WSL_TOOLCHAIN_ERROR="Detected:
  bun: $bun_display
    resolved: $bun_resolved

OperatorOS requires the Linux Bun contract declared by the root package.json inside WSL.
State: ${OPERATOROS_WSL_TOOLCHAIN_STATE}
Reason: ${OPERATOROS_WSL_TOOLCHAIN_REASON:-toolchain validation failed}

Do not use bun.exe from /mnt/c for OperatorOS development."
}

operatoros_wsl_prepare_bun() {
  local project_root="${1:?repository root is required}"
  if operatoros_wsl_validate_bun "$project_root"; then
    OPERATOROS_BUN_BIN="$(dirname -- "$OPERATOROS_BUN_REALPATH")"
    export PATH="$OPERATOROS_BUN_BIN:$PATH"
    hash -r 2>/dev/null || true
    return 0
  fi
  operatoros_wsl_toolchain_failure
  return 1
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  project_root="${2:-.}"
  if [[ "${1:-}" == "--probe" ]]; then
    if operatoros_wsl_validate_bun "$project_root"; then
      printf 'WSL Bun probe: PASS\n'
      printf '  bun: %s\n' "$OPERATOROS_BUN_PATH"
      printf '  bun resolved: %s\n' "$OPERATOROS_BUN_REALPATH"
      printf '  bun version: %s\n' "$OPERATOROS_BUN_VERSION"
      exit 0
    fi
    operatoros_wsl_toolchain_failure
    printf '%s\n' "$OPERATOROS_WSL_TOOLCHAIN_ERROR" >&2
    exit 1
  fi
  printf 'Usage: %s --probe [repo-dir]\n' "$0" >&2
  exit 2
fi

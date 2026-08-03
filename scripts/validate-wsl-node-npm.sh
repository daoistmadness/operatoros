#!/usr/bin/env bash

# Sourceable, repository-scoped validation for the WSL JavaScript toolchain.
# This file intentionally does not install, download, or permanently configure
# any runtime.  It only changes the current shell when NVM is auto-activated.

OPERATOROS_NODE_PATH=""
OPERATOROS_NPM_PATH=""
OPERATOROS_NODE_COMMAND=""
OPERATOROS_NPM_COMMAND=""
OPERATOROS_NODE_REALPATH=""
OPERATOROS_NPM_REALPATH=""
OPERATOROS_NODE_VERSION=""
OPERATOROS_NPM_VERSION=""
OPERATOROS_WSL_TOOLCHAIN_REASON=""
OPERATOROS_WSL_TOOLCHAIN_ERROR=""
OPERATOROS_WSL_TOOLCHAIN_VERSION_CHECKS="not-run"
OPERATOROS_WSL_TOOLCHAIN_STATE="UNKNOWN"
OPERATOROS_NODE_PINNED_VERSION=""
OPERATOROS_NODE_MAJOR_REQUIRED=""
OPERATOROS_NPM_MAJOR_REQUIRED=""
OPERATOROS_NODE_BIN=""

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

operatoros_wsl_resolve_toolchain_paths() {
  OPERATOROS_NODE_COMMAND="$(command -v node 2>/dev/null || true)"
  OPERATOROS_NPM_COMMAND="$(command -v npm 2>/dev/null || true)"
  OPERATOROS_NODE_PATH="$(type -P node 2>/dev/null || true)"
  OPERATOROS_NPM_PATH="$(type -P npm 2>/dev/null || true)"
  OPERATOROS_NODE_REALPATH=""
  OPERATOROS_NPM_REALPATH=""
  [[ -n "$OPERATOROS_NODE_PATH" ]] && OPERATOROS_NODE_REALPATH="$(readlink -f -- "$OPERATOROS_NODE_PATH" 2>/dev/null || true)"
  [[ -n "$OPERATOROS_NPM_PATH" ]] && OPERATOROS_NPM_REALPATH="$(readlink -f -- "$OPERATOROS_NPM_PATH" 2>/dev/null || true)"
}

operatoros_wsl_paths_are_safe() {
  local candidate
  for candidate in "$OPERATOROS_NODE_COMMAND" "$OPERATOROS_NODE_PATH" "$OPERATOROS_NODE_REALPATH" "$OPERATOROS_NPM_COMMAND" "$OPERATOROS_NPM_PATH" "$OPERATOROS_NPM_REALPATH"; do
    [[ -n "$candidate" ]] || continue
    if operatoros_wsl_path_is_rejected "$candidate"; then
      OPERATOROS_WSL_TOOLCHAIN_REASON="a resolved executable points to a Windows runtime"
      OPERATOROS_WSL_TOOLCHAIN_STATE="UNSAFE_PATH"
      return 1
    fi
  done

  if [[ -z "$OPERATOROS_NODE_PATH" || -z "$OPERATOROS_NODE_REALPATH" || ! -x "$OPERATOROS_NODE_REALPATH" ]]; then
    OPERATOROS_WSL_TOOLCHAIN_REASON="Linux Node.js was not found or is not executable"
    OPERATOROS_WSL_TOOLCHAIN_STATE="MISSING"
    return 1
  fi
  if [[ -z "$OPERATOROS_NPM_PATH" || -z "$OPERATOROS_NPM_REALPATH" || ! -x "$OPERATOROS_NPM_REALPATH" ]]; then
    OPERATOROS_WSL_TOOLCHAIN_REASON="Linux npm was not found or is not executable"
    OPERATOROS_WSL_TOOLCHAIN_STATE="MISSING"
    return 1
  fi

  # NVM's npm entry point resolves below the same version prefix as node
  # (usually .../bin/npm -> .../lib/node_modules/npm/bin/npm-cli.js).
  local node_prefix
  node_prefix="$(dirname -- "$(dirname -- "$OPERATOROS_NODE_REALPATH")")"
  if [[ "$OPERATOROS_NPM_REALPATH" != "$node_prefix"/* ]]; then
    OPERATOROS_WSL_TOOLCHAIN_REASON="npm is not paired with the resolved Node.js installation"
    OPERATOROS_WSL_TOOLCHAIN_STATE="NODE_NPM_PREFIX_MISMATCH"
    return 1
  fi
  return 0
}

operatoros_wsl_read_package_engine() {
  local package_json="${1:?package.json is required}"
  local field="${2:?engine field is required}"
  sed -nE "s/^[[:space:]]*\"${field}\"[[:space:]]*:[[:space:]]*\"([^\"]+)\".*/\1/p" "$package_json" 2>/dev/null | head -n1
}

operatoros_wsl_read_runtime_contract() {
  local project_root="${1:?repository root is required}"
  local nvmrc="${2:-$project_root/.nvmrc}"
  local package_json="$project_root/frontend/package.json"
  local pinned node_engine npm_engine node_min node_max npm_min npm_max

  OPERATOROS_NODE_PINNED_VERSION=""
  OPERATOROS_NODE_MAJOR_REQUIRED=""
  OPERATOROS_NPM_MAJOR_REQUIRED=""
  OPERATOROS_WSL_TOOLCHAIN_STATE="CONFIG_INVALID"

  pinned="$(tr -d '[:space:]' < "$nvmrc" 2>/dev/null || true)"
  if [[ ! "$pinned" =~ ^v?([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
    OPERATOROS_WSL_TOOLCHAIN_REASON=".nvmrc must contain one semantic Node.js version"
    return 1
  fi
  OPERATOROS_NODE_PINNED_VERSION="${pinned#v}"
  OPERATOROS_NODE_MAJOR_REQUIRED="${BASH_REMATCH[1]}"

  if [[ ! -f "$package_json" ]]; then
    OPERATOROS_WSL_TOOLCHAIN_REASON="frontend/package.json is missing"
    return 1
  fi
  node_engine="$(operatoros_wsl_read_package_engine "$package_json" node || true)"
  npm_engine="$(operatoros_wsl_read_package_engine "$package_json" npm || true)"
  if [[ ! "$node_engine" =~ ^\>=([0-9]+)[[:space:]]+\<([0-9]+)$ ]]; then
    OPERATOROS_WSL_TOOLCHAIN_REASON="frontend/package.json must declare a bounded Node.js engine"
    return 1
  fi
  node_min="${BASH_REMATCH[1]}"
  node_max="${BASH_REMATCH[2]}"
  if [[ ! "$npm_engine" =~ ^\>=([0-9]+)[[:space:]]+\<([0-9]+)$ ]]; then
    OPERATOROS_WSL_TOOLCHAIN_REASON="frontend/package.json must declare a bounded npm engine"
    return 1
  fi
  npm_min="${BASH_REMATCH[1]}"
  npm_max="${BASH_REMATCH[2]}"
  if (( OPERATOROS_NODE_MAJOR_REQUIRED < node_min || OPERATOROS_NODE_MAJOR_REQUIRED >= node_max )); then
    OPERATOROS_WSL_TOOLCHAIN_REASON=".nvmrc Node.js major ${OPERATOROS_NODE_MAJOR_REQUIRED} conflicts with frontend/package.json engines.node (${node_engine})"
    return 1
  fi
  OPERATOROS_NPM_MAJOR_REQUIRED="$npm_min"
  if (( npm_min >= npm_max )); then
    OPERATOROS_WSL_TOOLCHAIN_REASON="frontend/package.json declares an invalid npm engine range (${npm_engine})"
    return 1
  fi
  return 0
}

operatoros_wsl_paths_are_pinned_nvm() {
  local nvm_dir="${OPERATOROS_NVM_DIR:-${NVM_DIR:-$HOME/.nvm}}"
  local expected_node="$nvm_dir/versions/node/v${OPERATOROS_NODE_PINNED_VERSION}/bin/node"
  local expected_realpath
  expected_realpath="$(readlink -f -- "$expected_node" 2>/dev/null || true)"
  [[ -n "$expected_realpath" && "$OPERATOROS_NODE_REALPATH" == "$expected_realpath" ]]
}

operatoros_wsl_validate_node_npm() {
  local project_root="${1:?repository root is required}"
  local nvmrc="${2:-$project_root/.nvmrc}"
  local resolved_root
  OPERATOROS_NODE_VERSION=""
  OPERATOROS_NPM_VERSION=""
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
  operatoros_wsl_read_runtime_contract "$project_root" "$nvmrc" || return 1
  operatoros_wsl_resolve_toolchain_paths
  operatoros_wsl_paths_are_safe || return 1

  # Only execute commands after both lexical and resolved paths have passed
  # the Windows-runtime checks above.
  OPERATOROS_WSL_TOOLCHAIN_VERSION_CHECKS="executed"
  local release_name node_version node_major npm_version npm_major
  release_name="$("$OPERATOROS_NODE_PATH" -p 'process.release.name' 2>/dev/null || true)"
  if [[ "$release_name" != node ]]; then
    OPERATOROS_WSL_TOOLCHAIN_REASON="the resolved runtime is not genuine Node.js (process.release.name=${release_name:-unknown})"
    return 1
  fi
  node_version="$("$OPERATOROS_NODE_PATH" --version 2>/dev/null || true)"
  if [[ ! "$node_version" =~ ^v([0-9]+)\. ]]; then
    OPERATOROS_WSL_TOOLCHAIN_REASON="Node.js did not return a usable semantic version"
    return 1
  fi
  node_major="${BASH_REMATCH[1]}"
  if [[ "$node_major" != "$OPERATOROS_NODE_MAJOR_REQUIRED" ]]; then
    OPERATOROS_WSL_TOOLCHAIN_REASON="Node.js major version must match .nvmrc (${OPERATOROS_NODE_MAJOR_REQUIRED}; detected ${node_version})"
    OPERATOROS_WSL_TOOLCHAIN_STATE="SAFE_WRONG_VERSION"
    return 1
  fi
  if ! npm_version="$("$OPERATOROS_NPM_PATH" --version 2>/dev/null)"; then
    OPERATOROS_WSL_TOOLCHAIN_REASON="the paired npm executable is not usable"
    return 1
  fi
  if [[ -z "$npm_version" ]]; then
    OPERATOROS_WSL_TOOLCHAIN_REASON="the paired npm executable returned no version"
    return 1
  fi
  if [[ ! "$npm_version" =~ ^([0-9]+)\. ]]; then
    OPERATOROS_WSL_TOOLCHAIN_REASON="npm did not return a usable semantic version"
    OPERATOROS_WSL_TOOLCHAIN_STATE="SAFE_WRONG_VERSION"
    return 1
  fi
  npm_major="${BASH_REMATCH[1]}"
  if [[ "$npm_major" != "$OPERATOROS_NPM_MAJOR_REQUIRED" ]]; then
    OPERATOROS_WSL_TOOLCHAIN_REASON="npm major version must match frontend/package.json engines.npm (${OPERATOROS_NPM_MAJOR_REQUIRED}; detected ${npm_version})"
    OPERATOROS_WSL_TOOLCHAIN_STATE="SAFE_WRONG_VERSION"
    return 1
  fi

  OPERATOROS_NODE_VERSION="$node_version"
  OPERATOROS_NPM_VERSION="$npm_version"
  OPERATOROS_WSL_TOOLCHAIN_STATE="SAFE_CORRECT"
  return 0
}

operatoros_wsl_toolchain_failure() {
  local pinned_version="${1:-${OPERATOROS_NODE_PINNED_VERSION:-<repository .nvmrc>}}"
  local node_display="${OPERATOROS_NODE_PATH:-<not found>}"
  local npm_display="${OPERATOROS_NPM_PATH:-<not found>}"
  local node_resolved="${OPERATOROS_NODE_REALPATH:-<unresolved>}"
  local npm_resolved="${OPERATOROS_NPM_REALPATH:-<unresolved>}"

  OPERATOROS_WSL_TOOLCHAIN_ERROR="Detected:
  node: $node_display
    resolved: $node_resolved
  npm: $npm_display
    resolved: $npm_resolved

OperatorOS requires the Linux Node.js/npm contract declared by .nvmrc and frontend/package.json inside WSL.
State: ${OPERATOROS_WSL_TOOLCHAIN_STATE}
Reason: ${OPERATOROS_WSL_TOOLCHAIN_REASON:-toolchain validation failed}

Activate:
  . ~/.nvm/nvm.sh
  nvm use $pinned_version
  hash -r

Do not use node.exe or npm.cmd from /mnt/c for OperatorOS development."
}

operatoros_wsl_activate_nvm() {
  local project_root="${1:?repository root is required}"
  local nvmrc="${2:?.nvmrc path is required}"
  local nvm_dir="${OPERATOROS_NVM_DIR:-${NVM_DIR:-$HOME/.nvm}}"
  local nvm_script="$nvm_dir/nvm.sh"
  local nvm_script_real
  [[ -s "$nvm_script" ]] || return 1
  nvm_script_real="$(readlink -f -- "$nvm_script" 2>/dev/null || true)"
  [[ -n "$nvm_script_real" ]] || return 1
  operatoros_wsl_path_is_rejected "$nvm_script_real" && return 1

  local pinned_version
  pinned_version="$(tr -d '[:space:]' < "$nvmrc" 2>/dev/null || true)"
  [[ -n "$pinned_version" ]] || return 1

  export NVM_DIR="$nvm_dir"
  # shellcheck disable=SC1090
  source "$nvm_script" || return 1
  command -v nvm > /dev/null 2>&1 || return 1
  nvm use "$pinned_version" > /dev/null 2>&1 || return 1
  # After nvm use, prepend the pinned version's bin dir explicitly so that any
  # earlier PATH entry (e.g. ~/.local/bin/node -> /mnt/c/.../node.exe) cannot
  # shadow the Linux binary in subsequent type -P / command -v lookups.
  local pinned_bin="$nvm_dir/versions/node/v${pinned_version#v}/bin"
  if [[ -d "$pinned_bin" ]]; then
    export PATH="$pinned_bin:$PATH"
  fi
  hash -r 2>/dev/null || true
  return 0
}

operatoros_wsl_prepare_node_npm() {
  local project_root="${1:?repository root is required}"
  local nvmrc="${2:?.nvmrc path is required}"
  if ! operatoros_wsl_read_runtime_contract "$project_root" "$nvmrc"; then
    operatoros_wsl_toolchain_failure
    return 1
  fi

  if operatoros_wsl_validate_node_npm "$project_root" "$nvmrc"; then
    if operatoros_wsl_paths_are_pinned_nvm; then
      OPERATOROS_NODE_BIN="$(dirname -- "$OPERATOROS_NODE_REALPATH")"
      export PATH="$OPERATOROS_NODE_BIN:$PATH"
      hash -r 2>/dev/null || true
      return 0
    fi
    OPERATOROS_WSL_TOOLCHAIN_STATE="SAFE_WRONG_VERSION"
    OPERATOROS_WSL_TOOLCHAIN_REASON="the safe runtime is not the repository-pinned installation from existing Linux NVM"
  fi
  if operatoros_wsl_activate_nvm "$project_root" "$nvmrc" && operatoros_wsl_validate_node_npm "$project_root" "$nvmrc"; then
    if operatoros_wsl_paths_are_pinned_nvm; then
      OPERATOROS_NODE_BIN="$(dirname -- "$OPERATOROS_NODE_REALPATH")"
      export PATH="$OPERATOROS_NODE_BIN:$PATH"
      hash -r 2>/dev/null || true
      return 0
    fi
    OPERATOROS_WSL_TOOLCHAIN_STATE="SAFE_WRONG_VERSION"
    OPERATOROS_WSL_TOOLCHAIN_REASON="NVM did not activate the repository-pinned Linux installation"
  fi
  operatoros_wsl_toolchain_failure "${OPERATOROS_NODE_PINNED_VERSION:-<repository .nvmrc>}"
  return 1
}

operatoros_wsl_probe_node_npm() {
  local project_root="${1:-$PWD}"
  local nvmrc="${2:-$project_root/.nvmrc}"

  if operatoros_wsl_validate_node_npm "$project_root" "$nvmrc"; then
    printf 'WSL Node/npm probe: PASS\n'
    printf '  node: %s\n' "$OPERATOROS_NODE_PATH"
    printf '  node resolved: %s\n' "$OPERATOROS_NODE_REALPATH"
    printf '  node version: %s\n' "$OPERATOROS_NODE_VERSION"
    printf '  npm: %s\n' "$OPERATOROS_NPM_PATH"
    printf '  npm resolved: %s\n' "$OPERATOROS_NPM_REALPATH"
    printf '  npm version: %s\n' "$OPERATOROS_NPM_VERSION"
    return 0
  fi

  printf 'WSL Node/npm probe: FAIL\n'
  printf '  node: %s\n' "${OPERATOROS_NODE_PATH:-<not found>}"
  printf '  node resolved: %s\n' "${OPERATOROS_NODE_REALPATH:-<unresolved>}"
  printf '  npm: %s\n' "${OPERATOROS_NPM_PATH:-<not found>}"
  printf '  npm resolved: %s\n' "${OPERATOROS_NPM_REALPATH:-<unresolved>}"
  if [[ "$OPERATOROS_WSL_TOOLCHAIN_VERSION_CHECKS" == not-run ]]; then
    printf '  version checks: not run because executable paths failed WSL safety validation\n'
  fi
  operatoros_wsl_toolchain_failure "${OPERATOROS_NODE_PINNED_VERSION:-<repository .nvmrc>}"
  printf '%s\n' "$OPERATOROS_WSL_TOOLCHAIN_ERROR"
  return 1
}

operatoros_wsl_usage() {
  printf 'Usage: %s --probe [repository-root]\n' "${0##*/}"
  printf '  Resolve and validate the active WSL Node.js/npm toolchain without NVM recovery.\n'
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  case "${1:-}" in
    --probe)
      shift
      if [[ "$#" -gt 1 ]]; then
        operatoros_wsl_usage >&2
        exit 2
      fi
      operatoros_wsl_probe_node_npm "${1:-$PWD}"
      exit $?
      ;;
    -h|--help)
      operatoros_wsl_usage
      exit 0
      ;;
    *)
      operatoros_wsl_usage >&2
      exit 2
      ;;
  esac
fi

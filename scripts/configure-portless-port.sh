#!/usr/bin/env bash
# configure-portless-port.sh
# Manage Portless service port to coexist with Windows port 443 listeners.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORTLESS_STATE_DIR="${PORTLESS_STATE_DIR:-$HOME/.portless}"

find_portless_binary() {
  if command -v portless >/dev/null 2>&1; then
    command -v portless
    return 0
  fi
  local nvm_bin
  nvm_bin="$(find "$HOME/.nvm/versions/node" -maxdepth 3 -name portless 2>/dev/null | sort -V | tail -n 1 || true)"
  if [[ -x "$nvm_bin" ]]; then
    echo "$nvm_bin"
    return 0
  fi
  if [[ -x "$HOME/.bun/bin/portless" ]]; then
    echo "$HOME/.bun/bin/portless"
    return 0
  fi
  local npm_g_bin
  npm_g_bin="$(npm config get prefix 2>/dev/null || true)"
  if [[ -x "$npm_g_bin/bin/portless" ]]; then
    echo "$npm_g_bin/bin/portless"
    return 0
  fi
  echo "portless"
}

PORTLESS_BIN="$(find_portless_binary)"

portless() {
  "$PORTLESS_BIN" "$@"
}

detect_dapodik() {
  # Safe read-only powershell query for port 443
  local ps_cmd
  ps_cmd='
  $connections = Get-NetTCPConnection -LocalPort 443 -State Listen -ErrorAction SilentlyContinue
  if ($connections) {
      $results = foreach ($conn in $connections) {
          $owningPid = $conn.OwningProcess
          $proc = Get-Process -Id $owningPid -ErrorAction SilentlyContinue
          $service = Get-CimInstance Win32_Service | Where-Object { $_.ProcessId -eq $owningPid } -ErrorAction SilentlyContinue
          [PSCustomObject]@{
              LocalAddress = $conn.LocalAddress
              LocalPort = $conn.LocalPort
              OwningProcess = $owningPid
              ProcessName = if ($proc) { $proc.ProcessName } else { "unknown" }
              ProcessPath = if ($proc) { $proc.Path } else { "unknown" }
              ServiceName = if ($service) { $service.Name } else { "unknown" }
              ServiceDisplayName = if ($service) { $service.DisplayName } else { "unknown" }
              ServiceState = if ($service) { $service.State } else { "unknown" }
              ServicePath = if ($service) { $service.PathName } else { "unknown" }
          }
      }
      $results | ConvertTo-Json -Compress
  } else {
      "[]"
  }
  '
  powershell.exe -NoProfile -Command "$ps_cmd" 2>/dev/null || echo "[]"
}

get_installed_port() {
  local svc_out
  svc_out="$(portless service status 2>/dev/null || true)"
  local parsed_port
  parsed_port="$(printf '%s' "$svc_out" | grep -oP 'Proxy on \K[0-9]+' | head -1 || true)"
  if [[ "$parsed_port" =~ ^[0-9]+$ ]]; then
    echo "$parsed_port"
  else
    echo "443"
  fi
}

run_check() {
  echo "=== Portless Port Configuration Check ==="
  local active_port
  active_port="$(get_installed_port)"
  echo "Portless service port: $active_port"
  echo "State directory      : $PORTLESS_STATE_DIR"
  echo ""

  local dapodik_json
  dapodik_json="$(detect_dapodik)"
  
  if [[ "$dapodik_json" != "[]" && -n "$dapodik_json" ]]; then
    python3 - "$dapodik_json" <<'PY'
import sys
import json
try:
    data = json.loads(sys.argv[1])
    if not isinstance(data, list):
        data = [data]
except:
    data = []

dapodik = False
for item in data:
    name = item.get("ServiceName", "unknown")
    proc = item.get("ProcessName", "unknown")
    spath = item.get("ServicePath", "unknown")
    print(f"Windows port 443 listener detected:")
    print(f"  Process name: {proc}")
    print(f"  Service name: {name}")
    print(f"  Service path: {spath}")
    if "dapodik" in name.lower() or "dapodik" in spath.lower():
        dapodik = True

if dapodik:
    print("\n[WARNING] Windows port 443 is owned by Dapodik Apache.")
    print("Windows browsers cannot reach WSL Portless on port 443 while this listener is active.")
PY
  else
    echo "No listener found on Windows port 443."
  fi
}

usage() {
  echo "Usage: $0 [OPTIONS]"
  echo ""
  echo "Options:"
  echo "  --check          Read-only check of conflict and Portless service status"
  echo "  --port <port>    Reinstall Portless service on the specified port"
  echo "  --rollback-443   Reinstall Portless service on default port 443"
}

reconfigure_port() {
  local target_port="$1"
  if ! [[ "$target_port" =~ ^[0-9]+$ ]] || (( target_port < 1 || target_port > 65535 )); then
    echo "ERROR: Invalid port: $target_port. Must be between 1 and 65535." >&2
    exit 1
  fi

  local active_port
  active_port="$(get_installed_port)"
  if [[ "$active_port" == "$target_port" ]]; then
    echo "Portless service is already configured on port $target_port. No changes needed."
    return 0
  fi

  echo "WARNING: Reconfiguring Portless service will affect ALL projects using Portless on this machine."
  echo "We will run the following privileged commands:"
  echo "  1. sudo $PORTLESS_BIN service uninstall"
  echo "  2. sudo $PORTLESS_BIN service install --port $target_port --state-dir \"$PORTLESS_STATE_DIR\""
  echo ""
  read -r -p "Confirm reconfiguring Portless service to port $target_port? [y/N] " yn
  case "$yn" in
    [yY]|[yY][eE][sS])
      echo "Executing: sudo $PORTLESS_BIN service uninstall"
      sudo "$PORTLESS_BIN" service uninstall
      echo "Executing: sudo $PORTLESS_BIN service install --port $target_port --state-dir \"$PORTLESS_STATE_DIR\""
      sudo "$PORTLESS_BIN" service install --port "$target_port" --state-dir "$PORTLESS_STATE_DIR"
      
      local node_bin
      node_bin="$(dirname "$PORTLESS_BIN")/node"
      if [[ -f "/etc/systemd/system/portless.service" && -x "$node_bin" ]]; then
        echo "Fixing /etc/systemd/system/portless.service to use Node instead of Bun..."
        sudo python3 - "$node_bin" <<'PY'
import sys, re
node_bin = sys.argv[1]
path = "/etc/systemd/system/portless.service"
with open(path, "r") as f:
    content = f.read()

new_content = re.sub(r'ExecStart="[^"]+"', f'ExecStart="{node_bin}"', content)

with open(path, "w") as f:
    f.write(new_content)
PY
        echo "Reloading systemd and restarting portless..."
        sudo systemctl daemon-reload
        sudo systemctl restart portless
      fi
      
      echo "Portless service successfully reconfigured to port $target_port."
      echo "Rollback command: $0 --rollback-443"
      ;;
    *)
      echo "Aborted by user. No changes made."
      exit 0
      ;;
  esac
}

if [[ $# -eq 0 ]]; then
  usage
  exit 1
fi

case "$1" in
  --check)
    run_check
    ;;
  --port)
    if [[ $# -lt 2 ]]; then
      echo "ERROR: --port requires a port number." >&2
      exit 1
    fi
    reconfigure_port "$2"
    ;;
  --rollback-443)
    reconfigure_port "443"
    ;;
  *)
    usage
    exit 1
    ;;
esac

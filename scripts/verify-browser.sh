#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_ID="$(date +%Y%m%d-%H%M%S)"
ARTIFACT_DIR="${DEV_BROWSER_ARTIFACT_DIR:-$ROOT_DIR/.artifacts/browser}"
SESSION_NAME="${AGENT_BROWSER_SESSION_NAME:-school-attendance-smoke-$RUN_ID}"
PORTLESS_FRONTEND_NAME="${PORTLESS_FRONTEND_NAME:-school-attendance}"
TARGET_URL="${1:-}"
SCREENSHOT_PATH="$ARTIFACT_DIR/$RUN_ID-dashboard.png"

mkdir -p "$ARTIFACT_DIR"

log() {
  printf '[browser-smoke] %s\n' "$*"
}

die() {
  printf '[browser-smoke] ERROR: %s\n' "$*" >&2
  exit 1
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

ab() {
  agent-browser --session "$SESSION_NAME" "$@"
}

resolve_url() {
  if [[ -n "$TARGET_URL" ]]; then
    printf '%s' "$TARGET_URL"
    return 0
  fi

  if ! command_exists portless; then
    return 1
  fi

  local url=""
  url="$(portless get "$PORTLESS_FRONTEND_NAME" 2>/dev/null | tail -n 1 || true)"
  if [[ "$url" == http* ]]; then
    printf '%s' "${url%$'\r'}"
    return 0
  fi

  return 1
}

check_agent_browser() {
  if ! command_exists agent-browser; then
    die "agent-browser is not installed. Install it with 'npm install -g agent-browser' and then run 'agent-browser install' (or 'agent-browser install --with-deps' on Linux/WSL2)."
  fi

  local version
  version="$(agent-browser --version 2>/dev/null || true)"
  log "Agent Browser version: ${version:-unknown}"

  if ! agent-browser doctor --offline --quick >/tmp/agent-browser-doctor.log 2>&1; then
    cat /tmp/agent-browser-doctor.log >&2 || true
    die "agent-browser doctor failed. Install browser binaries with 'agent-browser install' (or 'agent-browser install --with-deps' on Linux/WSL2)."
  fi
}

run_eval() {
  local description="$1"
  local script="$2"
  log "$description"
  ab eval "$script"
}

main() {
  local url
  url="$(resolve_url)" || die "Pass the frontend URL explicitly or start the stack with Portless so the script can resolve it."

  check_agent_browser
  log "Using frontend URL: $url"
  log "Session: $SESSION_NAME"

  trap 'ab close >/dev/null 2>&1 || true' EXIT

  ab open "$url"
  ab wait 2000

  local title
  title="$(ab get title | tail -n 1 | tr -d '\r')"
  [[ -n "$title" ]] || die "The page title is empty."
  log "Title: $title"

  ab find text "System Analytics"
  ab find text "Upload Data" click
  ab wait 1000
  ab find text "Import Attendance Data"
  ab find text "Dashboard" click
  ab wait 1000
  ab find text "Settings" click
  ab wait 1000
  ab find text "System Settings"

  run_eval "Checking same-origin API health response" "(async () => {
    const response = await fetch('/api/system/health', { headers: { Accept: 'application/json' } });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(\`Unexpected status \${response.status}\`);
    }
    if (body.includes('<!doctype html') || body.includes('<html')) {
      throw new Error('Expected JSON from /api/system/health, received HTML.');
    }
    if (!body.includes('destructive_operations_enabled')) {
      throw new Error('Health payload is missing the destructive flag.');
    }
    return body;
  })()"

  run_eval "Checking same-origin template download response" "(async () => {
    const response = await fetch('/api/uploads/sample-template');
    const contentType = response.headers.get('content-type') || '';
    const body = await response.text();
    if (!response.ok) {
      throw new Error(\`Unexpected status \${response.status}\`);
    }
    if (contentType.includes('text/html') || body.includes('<!doctype html') || body.includes('<html')) {
      throw new Error('Expected a file response from /api/uploads/sample-template, received HTML.');
    }
    return contentType || 'no-content-type';
  })()"

  local page_errors console_output
  page_errors="$(ab errors 2>&1 || true)"
  console_output="$(ab console 2>&1 || true)"
  printf '%s\n' "$page_errors" >"$ARTIFACT_DIR/$RUN_ID-page-errors.txt"
  printf '%s\n' "$console_output" >"$ARTIFACT_DIR/$RUN_ID-console.txt"

  if grep -qiE '(TypeError|ReferenceError|SyntaxError|Unhandled|CORS|mixed-content|net::ERR|Failed to fetch|ERR_FAILED)' <<<"$page_errors"; then
    die "Browser page errors indicate a routing or runtime problem. See $ARTIFACT_DIR/$RUN_ID-page-errors.txt"
  fi

  if grep -qiE '(TypeError|ReferenceError|SyntaxError|Unhandled|CORS|mixed-content|net::ERR|Failed to fetch|ERR_FAILED)' <<<"$console_output"; then
    die "Browser console errors indicate a routing or runtime problem. See $ARTIFACT_DIR/$RUN_ID-console.txt"
  fi

  ab screenshot "$SCREENSHOT_PATH"
  log "Screenshot: $SCREENSHOT_PATH"
  log "Browser smoke test completed successfully."
}

main "$@"

operatoros_release_consumer_exit() {
  local consumer_status=$?
  local workspace="$1"
  local temp_parent="$2"
  local cleanup_status=0
  local helper_dir
  local -a args

  trap - EXIT
  helper_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
  args=("$helper_dir/release-consumer-cleanup.py" "$workspace" "$temp_parent")
  if [[ -n "${RUNNER_TEMP:-}" ]]; then
    args+=(--diagnostics-dir "$RUNNER_TEMP/release-diagnostics")
  fi

  if python3 "${args[@]}"; then
    :
  else
    cleanup_status=$?
  fi

  if (( consumer_status != 0 )); then
    printf '[consumer] failed with exit code %s\n' "$consumer_status" >&2
  fi
  if (( cleanup_status != 0 )); then
    printf '[cleanup] failed with exit code %s\n' "$cleanup_status" >&2
  fi

  if (( consumer_status != 0 )); then
    exit "$consumer_status"
  fi
  exit "$cleanup_status"
}

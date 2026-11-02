operatoros_e2e_remove_runtime_root() {
  local runtime_root="$1" expected_parent="${2:-/tmp}" suffix
  expected_parent="$(cd -- "$expected_parent" && pwd -P)" || return 1
  [[ "$runtime_root" == "$expected_parent/operatoros-e2e."* && -d "$runtime_root" && ! -L "$runtime_root" ]] || return 1
  suffix="${runtime_root#"$expected_parent/operatoros-e2e."}"
  [[ "$suffix" =~ ^[[:alnum:]]{6}$ ]] || return 1
  find "$runtime_root" -depth -delete
}

operatoros_e2e_cleanup() {
  local runtime_root="$1" stack_started="$2" stack_stopped="$3" cleanup_function="${4:-}" status=0 expected_parent="${5:-/tmp}"
  if [[ "$stack_started" == true && "$stack_stopped" != true && -n "$cleanup_function" ]]; then "$cleanup_function" || status=$?; fi
  operatoros_e2e_remove_runtime_root "$runtime_root" "$expected_parent" || status=$?
  return "$status"
}

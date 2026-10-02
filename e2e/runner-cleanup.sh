operatoros_e2e_remove_runtime_root() {
  local runtime_root="$1"
  [[ "$runtime_root" =~ ^/tmp/operatoros-e2e\.[[:alnum:]]{6}$ && -d "$runtime_root" && ! -L "$runtime_root" ]] || return 1
  find "$runtime_root" -depth -delete
}

operatoros_e2e_cleanup() {
  local runtime_root="$1" stack_started="$2" stack_stopped="$3" status=0
  shift 3
  if [[ "$stack_started" == true && "$stack_stopped" != true ]]; then "$@" || status=$?; fi
  operatoros_e2e_remove_runtime_root "$runtime_root" || status=$?
  return "$status"
}

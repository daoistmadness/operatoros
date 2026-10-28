operatoros_test_tier_isolate_environment() {
  export XDG_DATA_HOME="${1:?temporary XDG_DATA_HOME is required}"
  unset DATABASE_URL DATABASE_PATH OPERATOROS_DATA_DIR OPERATOROS_DEV_DATA_DIR PROTECTED_DB_PATH BACKUP_DIR
}

operatoros_test_tier_cleanup() {
  local test_root="${1:?temporary test-tier directory is required}"
  local test_parent="${2:?temporary test-tier parent is required}"
  local status="${3:?test-tier exit status is required}"
  local actual_parent="${test_root%/*}"
  local basename="${test_root##*/}"
  trap - EXIT
  if [[ "$actual_parent" != "${test_parent%/}" || "$basename" != operatoros-test-tier.* || ! -d "$test_root" || -L "$test_root" ]]; then
    printf '%s\n' "Refusing unexpected test-tier cleanup path." >&2
    status=1
  elif ! rm -rf -- "$test_root"; then
    printf '%s\n' "Failed to remove the disposable test-tier directory." >&2
    status=1
  fi
  exit "$status"
}

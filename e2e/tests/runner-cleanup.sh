#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$repo_root/e2e/runner-cleanup.sh"
temporary_parent="$(cd -- "${TMPDIR:-/tmp}" && pwd -P)"

failed_workspace_root="$(mktemp -d "$temporary_parent/operatoros-e2e.XXXXXX")"
mkdir "$failed_workspace_root/state"
operatoros_e2e_cleanup "$failed_workspace_root" false false "" "$temporary_parent"
[[ ! -e "$failed_workspace_root" ]]

failed_shutdown_root="$(mktemp -d "$temporary_parent/operatoros-e2e.XXXXXX")"
mkdir "$failed_shutdown_root/state"
failing_stack_shutdown() { return 23; }
if operatoros_e2e_cleanup "$failed_shutdown_root" true false failing_stack_shutdown "$temporary_parent"; then
  exit 1
else
  [[ "$?" == 23 ]]
fi
[[ ! -e "$failed_shutdown_root" ]]

unowned_root="$(mktemp -d "$temporary_parent/operatoros-unowned.XXXXXX")"
if operatoros_e2e_remove_runtime_root "$unowned_root" "$temporary_parent"; then exit 1; fi
[[ -d "$unowned_root" ]]
rm -rf -- "$unowned_root"

alternate_parent="$(mktemp -d "$temporary_parent/operatoros-cleanup-parent.XXXXXX")"
alternate_root="$(mktemp -d "$alternate_parent/operatoros-e2e.XXXXXX")"
operatoros_e2e_remove_runtime_root "$alternate_root" "$alternate_parent"
[[ ! -e "$alternate_root" ]]
rmdir "$alternate_parent"

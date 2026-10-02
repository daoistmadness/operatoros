#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$repo_root/e2e/runner-cleanup.sh"

failed_workspace_root="$(mktemp -d /tmp/operatoros-e2e.XXXXXX)"
mkdir "$failed_workspace_root/state"
operatoros_e2e_cleanup "$failed_workspace_root" false false
[[ ! -e "$failed_workspace_root" ]]

failed_shutdown_root="$(mktemp -d /tmp/operatoros-e2e.XXXXXX)"
mkdir "$failed_shutdown_root/state"
failing_stack_shutdown() { return 23; }
if operatoros_e2e_cleanup "$failed_shutdown_root" true false failing_stack_shutdown; then
  exit 1
else
  [[ "$?" == 23 ]]
fi
[[ ! -e "$failed_shutdown_root" ]]

unowned_root="$(mktemp -d /tmp/operatoros-unowned.XXXXXX)"
if operatoros_e2e_remove_runtime_root "$unowned_root"; then exit 1; fi
[[ -d "$unowned_root" ]]
rm -rf -- "$unowned_root"

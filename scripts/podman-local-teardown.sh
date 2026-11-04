#!/usr/bin/env bash
set -euo pipefail

usage() {
  printf 'Usage: %s <workspace-from-podman-local-deploy>\n' "$0" >&2
  exit 2
}

[[ $# == 1 ]] || usage
workspace="$(realpath -e -- "$1")"
[[ "$workspace" == /var/tmp/operatoros-podman-local.* ]] || {
  printf 'Refusing to operate outside a direct /var/tmp/operatoros-podman-local.* workspace.\n' >&2
  exit 1
}
[[ "$(stat -c %u -- "$workspace")" == "$(id -u)" ]] || {
  printf 'Workspace owner does not match the current user.\n' >&2
  exit 1
}
marker="$workspace/.operatoros-podman-local"
[[ -f "$marker" && ! -L "$marker" ]] || {
  printf 'Ownership marker is absent or invalid; no containers changed.\n' >&2
  exit 1
}
run_id="$(<"$marker")"
[[ "$run_id" == "${workspace##*/}" && "$run_id" =~ ^operatoros-podman-local\.[A-Za-z0-9]+$ ]] || {
  printf 'Ownership marker does not match the workspace; no containers changed.\n' >&2
  exit 1
}
label="io.operatoros.podman-local-run=$run_id"

while IFS= read -r container_id; do
  [[ -n "$container_id" ]] || continue
  details="$(podman inspect --format '{{.Name}} {{ index .Config.Labels "io.operatoros.podman-local-run" }}' "$container_id")"
  read -r container_name container_run_id <<<"$details"
  container_name="${container_name#/}"
  [[ ( "$container_name" == "operatoros-api-$run_id" || "$container_name" == "operatoros-api-contender-$run_id" || "$container_name" == "operatoros-caddy-$run_id" || "$container_name" == "operatoros-restore-api-$run_id" || "$container_name" == "operatoros-restore-cli-$run_id" ) && "$container_run_id" == "$run_id" ]] || {
    printf 'Container ownership mismatch for %s; stopping teardown.\n' "$container_id" >&2
    exit 1
  }
  podman rm --force "$container_id" >/dev/null
  printf 'Removed owned container %s\n' "${details%% *}"
done < <(podman ps --all --quiet --filter "label=$label")

printf 'Synthetic data retained at %s\n' "$workspace"

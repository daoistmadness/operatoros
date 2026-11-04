#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
template="$repo_root/deploy/podman/operatoros-api.container.in"

usage() {
  printf 'Usage: %s <image-reference@sha256:digest> <absolute-output-path>\n' "$0" >&2
  exit 2
}

[[ $# == 2 ]] || usage
image_ref="$1"
output="$2"
[[ "$image_ref" =~ ^[A-Za-z0-9._/:+-]+@sha256:[0-9a-f]{64}$ ]] || {
  printf 'Image must be pinned by a lowercase SHA-256 digest.\n' >&2
  exit 2
}
[[ "$output" == /* && "$output" == *.container ]] || usage
[[ ! -L "$output" ]] || {
  printf 'Refusing a symlink output path: %s\n' "$output" >&2
  exit 1
}
[[ -f "$template" ]] || {
  printf 'Quadlet template is missing: %s\n' "$template" >&2
  exit 1
}

output_dir="$(dirname -- "$output")"
mkdir -p -- "$output_dir"
temporary="$(mktemp "$output_dir/.operatoros-api.container.XXXXXX")"
sed "s|@OPERATOROS_API_IMAGE@|$image_ref|g" "$template" >"$temporary"
if grep -q '@OPERATOROS_API_IMAGE@' "$temporary"; then
  printf 'Unrendered image placeholder remains in Quadlet output.\n' >&2
  exit 1
fi
chmod 0644 "$temporary"
mv -f -- "$temporary" "$output"
printf 'Rendered Quadlet: %s\n' "$output"

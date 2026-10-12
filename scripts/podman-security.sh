#!/usr/bin/env bash
set -Eeuo pipefail

version=0.75.0
archive_sha256=c6e65abddb348e25f10549df887045629cf28cc72453cd1c63acb717316b3f3f
cache="${TRIVY_CACHE_DIR:-${RUNNER_TEMP:-/tmp}/operatoros-trivy-cache}"
output="${OPERATOROS_SECURITY_OUTPUT:-${RUNNER_TEMP:-/tmp}/operatoros-security}"

trivy_bin="$(command -v trivy || true)"
if [ -n "$trivy_bin" ]; then
  test "$("$trivy_bin" --version | awk 'NR == 1 {print $2}')" = "$version" || { echo "Trivy $version is required." >&2; exit 1; }
else
  temp="$(mktemp -d)"
  trap 'rm -rf -- "$temp"' EXIT
  archive="$temp/trivy.tar.gz"
  url="https://github.com/aquasecurity/trivy/releases/download/v$version/trivy_${version}_Linux-64bit.tar.gz"
  curl --fail --location --retry 3 --output "$archive" "$url"
  printf '%s  %s\n' "$archive_sha256" "$archive" | sha256sum --check --status || { echo 'Pinned Trivy archive checksum mismatch.' >&2; exit 1; }
  tar -xzf "$archive" -C "$temp" trivy
  trivy_bin="$temp/trivy"
fi

mkdir -p "$cache" "$output"
temp="$(mktemp -d)"
trap 'rm -rf -- "$temp"' EXIT
security_failed=0
for pair in "api:localhost/operatoros-api:${OPERATOROS_IMAGE_TAG:-worktree}" "web:localhost/operatoros-web:${OPERATOROS_IMAGE_TAG:-worktree}"; do
  name="${pair%%:*}"
  image="${pair#*:}"
  podman image exists "$image" || { echo "Required Podman image is missing: $image" >&2; exit 1; }
  # Scan an OCI layout export so Trivy never needs a Podman API socket.
  image_layout="$temp/operatoros-$name"
  podman save --format oci-dir --output "$image_layout" "$image"
  if ! "$trivy_bin" image --cache-dir "$cache" --scanners vuln,secret --input "$image_layout" \
    --format cyclonedx --output "$output/operatoros-$name.cdx.json"; then
    echo "Failed to generate $name CycloneDX SBOM." >&2
    security_failed=1
  fi
  if ! "$trivy_bin" image --cache-dir "$cache" --scanners vuln,secret --input "$image_layout" \
    --severity HIGH,CRITICAL --exit-code 1 --format table; then
    echo "Security policy failed for $name image." >&2
    security_failed=1
  fi
done
if [ "$security_failed" -ne 0 ]; then
  echo 'FAIL: OCI security policy did not pass for every image.' >&2
  exit 1
fi
printf 'PASS: pinned Trivy %s generated CycloneDX SBOMs and found no HIGH/CRITICAL vulnerabilities or embedded secrets.\n' "$version"

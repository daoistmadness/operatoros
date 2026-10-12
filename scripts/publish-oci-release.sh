#!/usr/bin/env bash
set -euo pipefail

fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }

: "${SOURCE_COMMIT:?SOURCE_COMMIT is required}"
: "${CI_RUN_ID:?CI_RUN_ID is required}"
: "${RELEASE_VERSION:?RELEASE_VERSION is required}"
: "${AUTH_FILE:?AUTH_FILE is required}"
: "${GITHUB_OUTPUT:?GITHUB_OUTPUT is required}"
[[ "$SOURCE_COMMIT" =~ ^[a-f0-9]{40}$ ]] || fail 'SOURCE_COMMIT must be a full commit SHA'
[[ "$CI_RUN_ID" =~ ^[0-9]+$ ]] || fail 'CI_RUN_ID must be numeric'
[[ -s "$AUTH_FILE" ]] || fail 'registry auth file is missing or empty'

artifact_files=(operatoros-api.oci operatoros-web.oci operatoros-api.cdx.json operatoros-web.cdx.json)
for file in "${artifact_files[@]}" oci-archives.sha256; do
  [[ -f "$file" && -s "$file" ]] || fail "required artifact is missing or empty: $file"
done

expected_files="$(printf '%s\n' "${artifact_files[@]}" | LC_ALL=C sort)"
actual_files="$(awk 'NF >= 2 { print $NF }' oci-archives.sha256 | LC_ALL=C sort)"
[[ "$actual_files" == "$expected_files" ]] || fail 'checksum file must list exactly both OCI archives and both CycloneDX SBOMs'
sha256sum --check --strict oci-archives.sha256

for sbom in operatoros-api.cdx.json operatoros-web.cdx.json; do
  jq -e 'type == "object" and .bomFormat == "CycloneDX"' "$sbom" >/dev/null || fail "invalid CycloneDX SBOM: $sbom"
done

archive_digest() {
  local archive="$1" index_json digest manifest_hash actual_hash
  index_json="$(tar -xOf "$archive" index.json)" || fail "missing OCI index in $archive"
  digest="$(jq -er 'if .schemaVersion == 2 and (.manifests | type) == "array" and (.manifests | length) == 1 and (.manifests[0].digest | test("^sha256:[a-f0-9]{64}$")) then .manifests[0].digest else error("expected exactly one SHA-256 OCI manifest") end' <<<"$index_json")" || fail "invalid OCI index in $archive"
  manifest_hash="${digest#sha256:}"
  actual_hash="$(tar -xOf "$archive" "blobs/sha256/$manifest_hash" | sha256sum | awk '{ print $1 }')" || fail "missing OCI manifest blob in $archive"
  [[ "sha256:$actual_hash" == "$digest" ]] || fail "OCI manifest blob digest mismatch in $archive"
  printf '%s' "$digest"
}

api_digest="$(archive_digest operatoros-api.oci)"
web_digest="$(archive_digest operatoros-web.oci)"

podman info --format 'version={{.Version.Version}} rootless={{.Host.Security.Rootless}} storage={{.Store.GraphDriverName}}'
[[ "$(podman info --format '{{.Host.Security.Rootless}}')" == true ]] || fail 'publisher requires rootless Podman'
podman load --input operatoros-api.oci
podman load --input operatoros-web.oci
podman image exists "localhost/operatoros-api:ci-${SOURCE_COMMIT}" || fail 'API archive does not contain the expected commit image'
podman image exists "localhost/operatoros-web:ci-${SOURCE_COMMIT}" || fail 'web archive does not contain the expected commit image'

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

publish_and_verify() {
  local name="$1" archive="$2" digest="$3" digest_file="$tmpdir/$1.digest" ref
  local image="ghcr.io/daoistmadness/$name"
  ref="$image@$digest"
  skopeo copy --quiet --preserve-digests --authfile "$AUTH_FILE" --digestfile "$digest_file" "oci-archive:$archive" "docker://$ref"
  [[ -s "$digest_file" ]] || fail "Skopeo did not record the $name registry digest"
  [[ "$(<"$digest_file")" == "$digest" ]] || fail "$name registry digest differs from the verified OCI archive"
  podman pull --quiet --authfile "$AUTH_FILE" "$ref"
  podman image inspect "$ref" --format '{{range .RepoDigests}}{{println .}}{{end}}' > "$tmpdir/$name.repo-digests"
  grep -Fqx "$ref" "$tmpdir/$name.repo-digests" || fail "$name pull-by-digest verification failed"
  printf '%s' "$ref"
}

api_ref="$(publish_and_verify operatoros-api operatoros-api.oci "$api_digest")"
web_ref="$(publish_and_verify operatoros-web operatoros-web.oci "$web_digest")"
api_sbom_sha="$(sha256sum operatoros-api.cdx.json | cut -d' ' -f1)"
web_sbom_sha="$(sha256sum operatoros-web.cdx.json | cut -d' ' -f1)"
manifest="$RUNNER_TEMP/operatoros-release-manifest.json"
jq -n \
  --arg version "$RELEASE_VERSION" \
  --arg source "$SOURCE_COMMIT" \
  --arg ci_run_id "$CI_RUN_ID" \
  --arg created "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg api "$api_ref" --arg web "$web_ref" \
  --arg api_sbom_sha "$api_sbom_sha" --arg web_sbom_sha "$web_sbom_sha" \
  '{manifestVersion: 2, releaseVersion: $version, sourceCommit: $source, ciRunId: $ci_run_id, schema: "20261002_s48", createdAt: $created, images: {api: $api, web: $web}, sbom: {api: {file: "operatoros-api.cdx.json", sha256: $api_sbom_sha}, web: {file: "operatoros-web.cdx.json", sha256: $web_sbom_sha}}}' \
  > "$manifest"
jq -e --arg source "$SOURCE_COMMIT" --arg ci_run_id "$CI_RUN_ID" --arg api "$api_ref" --arg web "$web_ref" '.manifestVersion == 2 and .schema == "20261002_s48" and .sourceCommit == $source and .ciRunId == $ci_run_id and .images.api == $api and .images.web == $web' "$manifest" >/dev/null || fail 'release manifest integrity check failed'

printf 'api-name=ghcr.io/daoistmadness/operatoros-api\n' >> "$GITHUB_OUTPUT"
printf 'api-digest=%s\napi-ref=%s\n' "$api_digest" "$api_ref" >> "$GITHUB_OUTPUT"
printf 'web-name=ghcr.io/daoistmadness/operatoros-web\n' >> "$GITHUB_OUTPUT"
printf 'web-digest=%s\nweb-ref=%s\n' "$web_digest" "$web_ref" >> "$GITHUB_OUTPUT"

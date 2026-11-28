#!/usr/bin/env bash
set -euo pipefail
baseline=13291d43b20d5fb9e93e0386a9fb5812a04f7650
image=docker.io/oven/bun:1.4.5-alpine@sha256:0a00c7befef11ec66adbc46655c64274108124546e32b5be8e571270d8c8ba31
test "${GITHUB_ACTIONS:-}" = true
test "${RUNNER_ENVIRONMENT:-}" = github-hosted
test "$(git rev-parse HEAD^)" = "$baseline"
# Exercise baseline source. The dedicated branch carries only these campaign inputs and review metadata.
git diff --name-only "$baseline" HEAD | awk '
  /^apps\/api\/tests\/excel-capacity-once\.ts$/ {next}
  !/^\.github\/excel-capacity\// && !/^\.github\/workflows\/excel-capacity-once.yml$/ && !/^CHANGELOG.md$/ && !/^\.intent\/review-state.json$/ {bad=1}
  END {exit bad}'
out="$(mktemp -d "$RUNNER_TEMP/excel-evidence.XXXXXX")"
input="$(mktemp -d "$RUNNER_TEMP/excel-fixtures.XXXXXX")"
name="excel-capacity-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
echo "EXCEL_EVIDENCE_PATH=$out" >> "$GITHUB_ENV"

finish() {
  local code=$?
  trap - EXIT
  if docker container inspect "$name" >/dev/null 2>&1; then
    docker rm -f "$name" >> "$out/cleanup.txt" 2>&1 || code=1
  fi
  local container_removed=true
  if docker container inspect "$name" >/dev/null 2>&1; then code=1; container_removed=false; fi
  rm -rf -- "$input"
  if [[ -e "$input" ]]; then code=1; fi
  printf 'container_removed=%s\nfixture_root_removed=%s\nexit=%s\n' "$container_removed" "$([[ -e "$input" ]] && echo false || echo true)" "$code" >> "$out/cleanup.txt"
  (cd "$out" && find . -maxdepth 1 -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS)
  exit "$code"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
printf 'source=%s\nworkflow_head=%s\nrun_id=%s\nattempt=%s\nimage=%s\n' "$baseline" "$GITHUB_SHA" "$GITHUB_RUN_ID" "$GITHUB_RUN_ATTEMPT" "$image" > "$out/manifest.txt"

printf '778ee003d9e091c3657525d5f2e90fdd1f5b0928bccb1cd4b298ff9f28ba82eb  .github/excel-capacity/attendance.xls\n' | sha256sum -c | tee "$out/biff8.txt"
test "$(stat -c %s .github/excel-capacity/attendance.xls)" = 237568
docker pull "$image"
docker image inspect "$image" --format '{{.Id}}' >> "$out/manifest.txt"

run() {
  local scenario="$1" mount_mode="$2" code
  local -a args=(
    --name "$name" --network none --read-only --cap-drop ALL
    --security-opt no-new-privileges --cgroupns private --cpus 1
    --memory 512m --memory-swap 512m --pids-limit 256
    --user "$(id -u):$(id -g)" --tmpfs /scratch:rw,nosuid,nodev,mode=1777
    --tmpfs /tmp:rw,nosuid,nodev,mode=1777
    --env NODE_ENV=test --mount "type=bind,src=$PWD,dst=/repo,readonly" --workdir /repo
  )
  if [[ "$mount_mode" == write ]]; then
    args+=(--mount "type=bind,src=$input,dst=/output")
  else
    args+=(--mount "type=bind,src=$input,dst=/input,readonly")
    if [[ "$scenario" == C ]]; then
      args+=(--mount "type=bind,src=$input,dst=/output")
    fi
  fi
  printf '%q ' docker run "${args[@]}" --entrypoint bun "$image" apps/api/tests/excel-capacity-once.ts "$scenario" >> "$out/commands.txt"
  printf '\n' >> "$out/commands.txt"
  code=0
  timeout --signal=TERM --kill-after=10s 150s docker run "${args[@]}" --entrypoint bun "$image" apps/api/tests/excel-capacity-once.ts "$scenario" 2>&1 | tee "$out/$scenario.jsonl" || code=$?
  docker inspect "$name" --format '{{json .State}}' > "$out/$scenario.container.json"
  docker rm -f "$name" >> "$out/cleanup.txt"
  printf '%s exit=%s\n' "$scenario" "$code" >> "$out/commands.txt"
  return "$code"
}
run prepare write
python3 - "$input" <<'PYTHON' | tee "$out/xlsx.json"
import hashlib, json, pathlib, sys, zipfile
root = pathlib.Path(sys.argv[1])
p = root / 'attendance.xlsx'
digest = hashlib.sha256(p.read_bytes()).hexdigest()
with zipfile.ZipFile(p) as workbook:
    expanded = sum(len(workbook.read(entry)) for entry in workbook.infolist())
(root / 'xlsx.sha256').write_text(digest + '\n')
print(json.dumps(dict(sha256=digest, compressed_file_bytes=p.stat().st_size, actual_zip_output_bytes=expanded,
    rows=5000, columns=9, sheets=1, generator='apps/api/tests/bun-runtime-smoke.ts attendance profile with fixed workbook metadata')))
PYTHON
for scenario in A B C D; do
  run "$scenario" read
  if [[ "$scenario" == C ]]; then run verify-exports read; fi
done

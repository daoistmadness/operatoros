#!/usr/bin/env bash
set -euo pipefail

echo "run-e2e=true" >>"${GITHUB_OUTPUT:?GITHUB_OUTPUT must be set}"
echo "Full E2E is mandatory for every PR, main push, merge group, and manual run." >>"${GITHUB_STEP_SUMMARY:?GITHUB_STEP_SUMMARY must be set}"

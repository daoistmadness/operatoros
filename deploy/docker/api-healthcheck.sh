#!/bin/sh
set -eu

exec bun -e 'fetch("http://127.0.0.1:8090/ready").then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))'

---
status: deprecated
last_reviewed: 2026-10-26
---

# Migration golden fixtures

The historical TypeScript-backend corpus remains under
docs/migration/ts-backend/golden. It contains JSON request/result examples,
workbook fixtures, manifests, and a small XLS fixture generator.
The tree is retained as migration evidence; current application behavior and
tests do not load this corpus automatically.

Repository source searches found no active API, package, script, or E2E test
consumer for the corpus as of 2026-10-26. Treat these files as frozen reference
data, not as the current OpenAPI contract or a passing compatibility suite.
The files named in the manifests remain unchanged by this documentation cleanup.

Before using any fixture in a current test, inspect its provenance, ensure it
contains only synthetic data, and wire it to a focused test that states the
behavior being protected. Keep generated test inputs under the test that owns
them when practical. Do not add real school records or personal data.

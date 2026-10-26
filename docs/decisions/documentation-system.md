---
status: current
last_reviewed: 2026-10-26
---

# Documentation system

## Decision

Keep maintained project documentation under docs and organize it by reader
task: architecture, guides, reference, decisions, runbooks, and session logs.
The documentation index at docs/README.md links to every maintained Markdown
page. Page names use kebab-case, and each page covers one topic.

Maintained documentation pages use front matter with status (current, draft, or
deprecated) and last_reviewed. The protected Dapodik design remains at its
existing path and content because repository instructions explicitly protect
it. Package-owned, generated, release, and contributor documents stay beside
their code or at their existing repository entry point.

## Authority and history

Source code, package manifests, lockfiles, and executable configuration define
current behavior. Documentation describes those sources and links to them.
Completed plans and one-off reports are removed after their current durable
decisions have been promoted; Git history retains prior text. No archive or old
folder is used as a documentation category.

Session logs belong only in docs/session. They are non-authoritative records.
Any durable decision or instruction from a log must also be added to its
canonical architecture, guide, reference, decision, or runbook page.

## Changelog

Every pull request adds one user-facing entry under Unreleased in the root
CHANGELOG.md, with its pull request number. The skip-changelog label is reserved
for changes that do not belong in the release history.

The repository-owned CI checks the docs layout, review metadata, complete docs
index, relative links, and changelog entry. It does not add a separate
Markdown-lint or remote-link dependency.

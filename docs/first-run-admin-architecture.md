# First-Run Administrator Architecture

## Current identity flow

OperatorOS stores local identities in migration-owned `users` and `sessions` tables. `User.username` is the canonical identity field; the current schema has no email or display-name columns. Authentication trims the submitted username, verifies passwords through the shared Argon2id helper in `security/password.py`, creates revocable server-side sessions, and writes safe JSONL authentication audit events. Roles are the constrained lowercase values `admin` and `staff`.

## Provisioning service design

`services.first_admin_provisioning` is the only account-bootstrap implementation. The setup API and interactive CLI both call it. The service trims the username, reuses `hash_password()` and its 12-character policy, assigns `admin`, and never returns or records password material.

The service transitions a singleton `first_admin_setup_state` row in the same database transaction that inserts the user. That row is both the permanent setup-closure guard and the atomic success audit record: it stores only completion time, created user ID, normalized username, and provisioning source. After commit, the existing append-only authentication JSONL log receives a `FIRST_ADMIN_PROVISIONED` operational mirror. A JSONL failure is reported to operators but cannot reopen setup or roll back an already committed identity.

## Setup-mode rules

- Setup is required only when no user exists and the singleton state is not completed.
- Any existing user closes setup, including installations upgraded from before Phase 9.3.
- Successful provisioning permanently marks the singleton state complete.
- A configured `ASTRYX_SETUP_TOKEN` makes the web endpoint require that token.
- Docker Compose requires an externally supplied setup token. Direct loopback development may leave it unset.
- The trusted interactive CLI bypasses the web token because it already requires local shell and database access; it still cannot run after setup closes.

## API contract

- `GET /api/setup/status` returns only `setup_required` and `setup_token_required`, with `Cache-Control: no-store`.
- `POST /api/setup/admin` accepts `username`, `password`, `password_confirmation`, and an optional `setup_token`.
- Success returns `201` with `id`, `username`, and `role`, then the operator signs in normally.
- Stable safe failures include `PASSWORD_CONFIRMATION_MISMATCH`, `PASSWORD_POLICY_FAILED`, `SETUP_TOKEN_REQUIRED`, `SETUP_TOKEN_INVALID`, `SETUP_ALREADY_COMPLETED`, and `PROVISIONING_FAILED`.

## Concurrency strategy

An in-process lock avoids needless contention. SQLite additionally starts `BEGIN IMMEDIATE`, obtaining the database writer reservation before eligibility is checked. PostgreSQL inserts the singleton row with `ON CONFLICT DO NOTHING` and selects it `FOR UPDATE`. The user check, admin insert, and singleton transition then occur in one transaction. A competing request waits, observes completion, and returns `SETUP_ALREADY_COMPLETED`. The database lock—not the process lock—is authoritative across processes.

## CLI behavior

`cd backend && PYTHONPATH=src .venv/bin/python -m cli create-admin` requires an interactive terminal, reads passwords with `getpass`, checks confirmation, calls the shared service, and emits only safe success/error text. Password command-line arguments are unsupported.

## Failure handling

Validation and token failures occur before mutation. Database, hashing, or atomic audit-state failures roll back the transaction. API errors never expose SQL details. Interrupting CLI input creates no transaction. Setup status is invalidated by the frontend after success or concurrent completion.

## Test strategy

Backend tests cover empty/existing state, token behavior, normalization, Argon2id, password policy, rollback, atomic audit state, API responses, CLI interaction, and simultaneous SQLite attempts. PostgreSQL SQL migrations and lock branches are validated statically unless a PostgreSQL 16 test service is available. Frontend provider tests cover status loading, conditional token input, validation, success redirection, and concurrent completion.

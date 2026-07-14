# User Administration

Astryx supports exactly one account-provisioning operation: secure first-run administrator creation through the setup screen or the interactive `PYTHONPATH=src .venv/bin/python -m cli create-admin` command from `backend/`. Both paths close permanently after the first user exists and reuse the Argon2id policy. Astryx still has no general user-management UI, invitation flow, password reset, role-management CLI, or public registration.

The following general-administration command shape remains unimplemented:

```text
python -m backend.cli users create
python -m backend.cli users disable
python -m backend.cli users reset-password
```

The implemented first-admin CLI uses interactive hidden input, the existing 12-character Argon2id policy, atomic setup state, and audit logging. It does not accept passwords in arguments and cannot add a second account.

Current roles are `admin` and `staff`. At least one active administrator is required for viable restore targets. Disabling the last active administrator can make administrative operations unavailable and must be prevented by the eventual administration workflow.

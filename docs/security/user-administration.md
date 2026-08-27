# User Administration

OperatorOS supports exactly one account-provisioning operation: secure first-run administrator creation through the setup screen. Setup closes permanently after the first user exists and reuses the Argon2id policy. OperatorOS still has no general user-management UI, invitation flow, password reset, role-management CLI, or public registration.

Current roles are `admin` and `staff`. At least one active administrator is required for viable restore targets. Disabling the last active administrator can make administrative operations unavailable and must be prevented by the eventual administration workflow.

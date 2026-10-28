# Changelog

Notable user-facing changes are recorded here.

## [Unreleased]

### Changed
- Reorganized and indexed the project documentation (#324)

### Added
- Manage versioned school units and dated staff assignments with explicit PTK applicability, audited cancellation, and calculated profile age.
- Filter Student Management and CSV exports by whether NISN has been entered (#326).
- Track monthly PTK processing by school unit, month, and year with eligibility snapshots, operator confirmation, history, and exports.
- Track NIK/KK identity verification, DAPODIK registration status, and IOM documents on the student administration profile and management filters (#330).
- Archive and track monthly UPP report workbooks per school unit and month with version replacement and submission tracking.
- Show an operational dashboard, an annual BOSP cut-off reminder, and a cross-module operator work queue with type filters and actionable navigation (#331).

### Fixed
- Require a strong authentication secret at startup, bound archive extraction, reject stale imports atomically, and batch sensitive roster exports.

### Removed

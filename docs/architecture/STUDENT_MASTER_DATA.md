# Student master data

The canonical student master is the administrative identity layer. It keeps
student identity, contact and guardian information, optional health/document
metadata, attendance-device history, and academic enrollment linked without
rewriting historical attendance records.

The directory supports masked search, status counts, current Jenjang/program/
grade/class placement, calculated age, quality indicators, and sanitized CSV
export. Profile updates use optimistic record versions and capability checks;
health data, document status, and guardian records are only exposed through
the authorized profile boundary.

Student attendance remains attached to the legacy student/device identity
mapping. Changing a canonical profile or current enrollment does not mutate
historical attendance rows.

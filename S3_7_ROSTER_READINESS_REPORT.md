# S3.7 Roster Readiness Report

## Candidate reassessment

`Data Siswa TA 2025_2026.xlsx` contains useful identity and class evidence but cannot become an approved roster merely through technical cleanup.

| Required remediation | Technically possible | Governance status |
|---|---|---|
| Filter inactive students | No | Workbook has no per-row status source |
| Add academic year | Yes as a derived column | Requires registrar confirmation; filename alone is insufficient |
| Map identities | Partial | 78 name-only candidates are prohibited; 39 masters are absent |
| Remove duplicates | Possible | Must retain official source lineage |
| Map jenjang | No | Primary incomplete; Secondary/early-years structure unapproved |
| Map classes | No | Program/class masters remain empty pending approval |

## Master import foundation

S3.7 added empty additive `academic_programs`, `academic_classes`, and `academic_master_import_previews` storage, jenjang governance fields, and a nullable restrictive class reference on enrollments. The admin-only preview validates hierarchy and duplicates while leaving canonical tables unchanged. No approval or commit route exists yet.

## Stop decision

Official academic structure, jenjang ownership, class structure, and roster identity authority remain unavailable. Therefore:

- no academic-master proposal was generated against live data;
- no canonical master was inserted or enriched;
- no roster preview was approved;
- no enrollment was committed.

Readiness resumes only after an authorized academic owner supplies the approved hierarchy and a roster covering all 117 linked students with secure identity keys and active status.


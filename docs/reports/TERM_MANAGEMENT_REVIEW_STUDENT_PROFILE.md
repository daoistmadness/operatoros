# Term Management Review — Student Profile

## Authority matrix

| Business concept | Canonical table/source | API/service owner | Existing contract | Existing analytics consumer | Historical availability | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Academic year | `academic_years` | academic configuration | analytics filter contracts | all analytics | Yes | Selected by ID. |
| Term and window | `academic_term_configs` | academic configuration | academic term configuration API | academic analytics | Yes | This report rejects synthetic fallback terms. |
| Jenjang | `jenjangs` and enrollment `jenjang_id` | academic masters/enrollment | analytics filter contracts | recapitulation and analytics | Yes, through enrollment | Database ID order is the canonical structural order available today. |
| Program and grade | `academic_programs`, `academic_grades` | academic masters | academic master APIs | academic analytics | Yes, through class hierarchy | The management section reports the canonical jenjang level. |
| Class | `academic_classes` and enrollment `academic_class_id` | academic masters/enrollment | academic options contracts | attendance and academic analytics | Yes, through enrollment | Class scope belongs to the selected academic year. |
| Student | `student_masters` | student master | student contracts | Student 360 and Data Quality | Current master | Canonical student ID provides uniqueness. |
| Enrollment and status | `student_enrollments` | enrollment | enrollment APIs | recapitulation and analytics | Date-valid rows | Population uses enrollment overlap with the configured term window. |
| Gender | `student_masters.gender` | student master | student contracts | recapitulation and Data Quality | Current only | Report wording explicitly says current profile data. |
| Residence | `student_addresses` | student master | student contracts | Student 360 | Current only | Only administrative aggregates are exposed. Full addresses are excluded. |
| Father occupation | `student_parent_guardians` where `guardian_type = father` | student master | student contracts | Student 360 | Current only | No socioeconomic inference. |
| Mother occupation | `student_parent_guardians` where `guardian_type = mother` | student master | student contracts | Student 360 | Current only | No socioeconomic inference. |

## Population rule

Select one canonical student whose enrollment belongs to the selected academic year and overlaps the configured term window. Rank overlapping enrollment rows by latest effective date and enrollment ID. Keep one row per `student_master_id`.

All demographic values are current profile values for students enrolled in the selected term. OperatorOS does not store demographic snapshots.

## KPI boundary

No canonical automated OPR KPI Actual source exists in the current product. OPR KPI entry and reporting remain operator-managed and manual. This feature adds no KPI persistence.

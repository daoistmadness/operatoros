# S3 Attendance Difference Report

Date: 2026-07-15  
Comparison key: `(student_id, date)` with every non-ID attendance field compared.

## Exact result

| Comparison | Count |
|---|---:|
| Logical attendance keys present in both | 3,409 |
| Runtime-only attendance keys | 0 |
| Reference-only attendance keys | 242 |
| Shared keys with different payloads | 0 |

The runtime dataset is an exact logical subset of the reference attendance dataset. No common attendance row differs in check-in, check-out, late duration/source, absence marker, overtime, exception, week, or status.

## Proven source of the difference

Runtime upload history:

- `absen anak sd bro.xls.xlsx`: 3,409 records, 107 new students.
- The same 3,409-record source was subsequently reprocessed twice, producing no new students.

Reference upload history:

- `absen anak sd bro.xls.xlsx`: 3,409 records, 107 new students.
- `absen smp term 4.xls.xlsx`: 242 records, 10 new students, 4 late entries.

The 242 reference-only attendance rows have database IDs 3,410–3,651 and belong exclusively to the same ten reference-only students. Their date range is 2026-04-01 through 2026-06-12. Status distribution is 238 on-time and 4 late. This exactly explains both count differences; it is not evidence of deleted or rewritten runtime attendance.

## Affected-student inventory

Raw names and scanner identifiers are intentionally omitted from this repository report. The ten affected source identities are deterministically recoverable with this read-only query against database B:

```sql
SELECT s.id, s.name, COUNT(a.id), MIN(a.date), MAX(a.date)
FROM students s
JOIN attendance a ON a.student_id = s.id
WHERE s.id NOT IN (SELECT id FROM runtime.students)
GROUP BY s.id, s.name
ORDER BY s.id;
```

Per-student reference-only attendance counts are: 23, 14, 10, 21, 19, 28, 17, 37, 31, and 42 (total 242). There are no runtime-only affected students.

## Date coverage

Reference-only rows occur on 47 dates across April–June 2026. Monthly additions are:

- April: 137 rows
- May: 85 rows
- June: 20 rows

The exact recorded source artifact `absen smp term 4.xls.xlsx` was not found in the checked project and user download locations. A differently named `absen smp rev.xls.xlsx` exists, but it covers a different period and must not be assumed equivalent.

## Interpretation

Database B received one valid-looking additional import before database A was created/reloaded with only the first source. Database A has since been actively used and has the authenticated runtime history. Database B is therefore content-richer for attendance but not a safe runtime replacement.


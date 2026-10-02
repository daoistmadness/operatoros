import type { Database, SQLQueryBindings } from "bun:sqlite";
import type { StaffAnalyticsSummaryDto } from "@operatoros/contracts/staff";

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function calculateAge(birthDate: string | null, asOfDate: string): number | null {
  if (!birthDate || !validDate(birthDate) || !validDate(asOfDate) || birthDate > asOfDate) return null;
  let age = Number(asOfDate.slice(0, 4)) - Number(birthDate.slice(0, 4));
  if (asOfDate.slice(5) < birthDate.slice(5)) age--;
  return age;
}

export function calculateTenureMonths(startDate: string | null, endDate: string | null, status: string, asOfDate: string): number | null {
  if (!startDate || !validDate(startDate)) return null;
  const end = status === "FORMER" ? endDate : status === "ACTIVE" ? asOfDate : null;
  if (!end || !validDate(end) || startDate > end) return null;
  let months = (Number(end.slice(0, 4)) - Number(startDate.slice(0, 4))) * 12 + Number(end.slice(5, 7)) - Number(startDate.slice(5, 7));
  if (Number(end.slice(8, 10)) < Number(startDate.slice(8, 10))) months--;
  return months < 0 ? null : months;
}

function percent(count: number, total: number): number | null { return total === 0 ? null : Math.round((count / total) * 1000) / 10; }
function distribution(values: string[], denominator: number) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([label, count]) => ({ label, count, percentage: percent(count, denominator) }));
}
function bandDistribution(values: string[], labels: string[], denominator: number) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return labels.map((label) => ({ label, count: counts.get(label) ?? 0, percentage: percent(counts.get(label) ?? 0, denominator) }));
}
function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return (sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2);
}
function bool(value: unknown): boolean { return value === true || value === 1 || value === "1"; }

export function staffAnalytics(db: Database, asOfDate: string, whereSql = "", params: SQLQueryBindings[] = []): StaffAnalyticsSummaryDto {
  const today = new Date().toISOString().slice(0, 10);
  if (!validDate(asOfDate) || asOfDate > today) throw new Error("INVALID_AS_OF_DATE");
  const rows = db.query(`SELECT s.id, s.employment_status, s.birth_date, s.employment_start_date, s.employment_end_date,
    s.created_at,
    s.dapodik_status_raw, s.dapodik_status_normalized, s.job_title_raw, s.job_title_normalized,
    (SELECT normalized_value FROM staff_identifiers i WHERE i.staff_member_id=s.id AND i.identifier_type='NIP' ORDER BY i.id LIMIT 1) AS nip,
    (SELECT normalized_value FROM staff_identifiers i WHERE i.staff_member_id=s.id AND i.identifier_type='NIK' ORDER BY i.id LIMIT 1) AS nik,
    (SELECT normalized_value FROM staff_identifiers i WHERE i.staff_member_id=s.id AND i.identifier_type='NUPTK' ORDER BY i.id LIMIT 1) AS nuptk,
    c.email, c.phone,
    m.position_category, m.is_teaching_role
    FROM staff_members s
    LEFT JOIN staff_contact_details c ON c.staff_member_id=s.id
    LEFT JOIN staff_job_title_mappings m ON lower(trim(m.raw_title))=lower(trim(s.job_title_raw)) AND m.status='APPROVED'
    ${whereSql} ORDER BY s.id`).all(...params) as Array<Record<string, unknown>>;
  const events = db.query(`SELECT h.staff_member_id,h.effective_date,h.employment_status,h.created_at
    FROM staff_employment_history h
    WHERE h.staff_member_id IN (SELECT s.id FROM staff_members s ${whereSql})
    ORDER BY h.staff_member_id,coalesce(h.effective_date,substr(h.created_at,1,10)),h.id`).all(...params) as Array<Record<string, unknown>>;
  const history = new Map<string, Array<Record<string, unknown>>>();
  for (const event of events) history.set(String(event.staff_member_id), [...(history.get(String(event.staff_member_id)) ?? []), event]);
  const statusAt = (row: Record<string, unknown>): string => {
    if (asOfDate === today) return String(row.employment_status ?? "UNKNOWN");
    if (typeof row.employment_start_date === "string" && row.employment_start_date > asOfDate) return "NOT_STARTED";
    const timeline = history.get(String(row.id)) ?? [];
    const prior = timeline.filter((event) => String(event.effective_date ?? event.created_at).slice(0, 10) <= asOfDate);
    if (prior.length) return String(prior[prior.length - 1]!.employment_status ?? "UNKNOWN");
    if (timeline.length) return "UNKNOWN";
    return typeof row.created_at === "string" && row.created_at.slice(0, 10) <= asOfDate ? String(row.employment_status ?? "UNKNOWN") : "UNKNOWN";
  };
  const asOfStatuses = new Map(rows.map((row) => [String(row.id), statusAt(row)]));
  const total = rows.length;
  const active = rows.filter((row) => asOfStatuses.get(String(row.id)) === "ACTIVE").length;
  const former = rows.filter((row) => asOfStatuses.get(String(row.id)) === "FORMER").length;
  const activeRows = rows.filter((row) => asOfStatuses.get(String(row.id)) === "ACTIVE");
  const teachingRows = activeRows.filter((row) => row.is_teaching_role !== null && row.is_teaching_role !== undefined);
  const teaching = teachingRows.filter((row) => bool(row.is_teaching_role)).length;
  const nonTeaching = teachingRows.length - teaching;
  const ages = rows.map((row) => calculateAge(row.birth_date == null ? null : String(row.birth_date), asOfDate));
  const knownAges = ages.filter((value): value is number => value !== null);
  const tenureMonths = rows.map((row) => calculateTenureMonths(row.employment_start_date == null ? null : String(row.employment_start_date), row.employment_end_date == null ? null : String(row.employment_end_date), asOfStatuses.get(String(row.id)) ?? "UNKNOWN", asOfDate));
  const knownTenure = tenureMonths.filter((value): value is number => value !== null);
  const ageBands = ages.map((age) => age === null ? "Unknown" : age < 25 ? "<25" : age < 35 ? "25–34" : age < 45 ? "35–44" : age < 55 ? "45–54" : "55+");
  const tenureBands = tenureMonths.map((months) => months === null ? "Unknown" : months < 12 ? "<1 year" : months < 36 ? "1–2 years" : months < 72 ? "3–5 years" : months < 132 ? "6–10 years" : months < 192 ? "11–15 years" : "16+ years");
  const withNuptk = rows.filter((row) => row.nuptk != null && String(row.nuptk).trim() !== "").length;
  const classifiedTitles = rows.filter((row) => row.position_category != null).length;
  const fieldValues: Array<[string, (row: Record<string, unknown>) => boolean]> = [
    ["nip", (row) => row.nip != null && String(row.nip).trim() !== ""], ["nik", (row) => row.nik != null && String(row.nik).trim() !== ""],
    ["nuptk", (row) => row.nuptk != null && String(row.nuptk).trim() !== ""], ["dapodik", (row) => row.dapodik_status_raw != null && String(row.dapodik_status_raw).trim() !== "" && row.dapodik_status_normalized !== "UNKNOWN"],
    ["birth_date", (row) => row.birth_date != null], ["employment_start_date", (row) => row.employment_start_date != null],
    ["email", (row) => row.email != null && String(row.email).trim() !== ""], ["phone", (row) => row.phone != null && String(row.phone).trim() !== ""],
  ];
  const dataQuality = fieldValues.map(([field, present]) => {
    const count = rows.filter(present).length;
    return { field, present: count, missing: total - count, coverage: percent(count, total) };
  });
  const dapodikValues = rows.map((row) => row.dapodik_status_normalized !== "UNKNOWN"
    ? String(row.dapodik_status_normalized)
    : row.dapodik_status_raw == null || !String(row.dapodik_status_raw).trim()
      ? "Unknown / blank"
      : `Unmapped: ${String(row.dapodik_status_raw).trim().toLocaleUpperCase("id")}`);
  const positionGroups = new Map<string, { count: number; active: number }>();
  const joinYears = rows.filter((row) => typeof row.employment_start_date === "string").map((row) => String(row.employment_start_date).slice(0, 4));
  for (const row of rows) {
    const label = String(row.job_title_normalized ?? row.job_title_raw ?? "Unmapped");
    const group = positionGroups.get(label) ?? { count: 0, active: 0 };
    group.count++;
    if (asOfStatuses.get(String(row.id)) === "ACTIVE") group.active++;
    positionGroups.set(label, group);
  }
  const presentFields = dataQuality.reduce((sum, field) => sum + field.present, 0);
  const eligibleFields = total * fieldValues.length;
  const duplicateIdentityCount = Number((db.query(`SELECT COUNT(*) AS count FROM (
    SELECT identifier_type,normalized_value FROM staff_identifiers
    WHERE identifier_type IN ('NIP','NIK','NUPTK') AND normalized_value IS NOT NULL AND trim(normalized_value)!=''
    GROUP BY identifier_type,normalized_value HAVING COUNT(DISTINCT staff_member_id)>1
  )`).get() as { count: number }).count);
  const invalidIdentifierCount = Number((db.query("SELECT COUNT(DISTINCT staff_member_id) AS count FROM staff_identifiers WHERE identifier_type IN ('NIP','NIK','NUPTK') AND verification_status='REVIEW_REQUIRED'").get() as { count: number }).count);
  const unresolvedImportConflictCount = Number((db.query(`SELECT COUNT(DISTINCT r.id) AS count FROM staff_import_rows r
    JOIN staff_import_issues i ON i.import_row_id=r.id
    WHERE r.row_status IN ('CONFLICT','REVIEW_REQUIRED') AND i.severity='ERROR' AND i.resolved_at IS NULL`).get() as { count: number }).count);
  return {
    as_of_date: asOfDate,
    workforce: { total, active, former, unknown_status: total - active - former, status_coverage: { count: active + former, percentage: percent(active + former, total) }, teaching: teachingRows.length ? teaching : null, non_teaching: teachingRows.length ? nonTeaching : null, unclassified_positions: total - classifiedTitles },
    age: { average_years: knownAges.length ? Math.round(knownAges.reduce((sum, value) => sum + value, 0) / knownAges.length * 10) / 10 : null, coverage: { count: knownAges.length, percentage: percent(knownAges.length, total) }, distribution: bandDistribution(ageBands, ["<25", "25–34", "35–44", "45–54", "55+", "Unknown"], total) },
    tenure: { average_years: knownTenure.length ? Math.round(knownTenure.reduce((sum, value) => sum + value, 0) / knownTenure.length / 12 * 10) / 10 : null, median_years: median(knownTenure) === null ? null : Math.round(median(knownTenure)! / 12 * 10) / 10, coverage: { count: knownTenure.length, percentage: percent(knownTenure.length, total) }, distribution: bandDistribution(tenureBands, ["<1 year", "1–2 years", "3–5 years", "6–10 years", "11–15 years", "16+ years", "Unknown"], total) },
    dapodik: { coverage: { count: dataQuality.find((field) => field.field === "dapodik")!.present, percentage: percent(dataQuality.find((field) => field.field === "dapodik")!.present, total) }, distribution: distribution(dapodikValues, total) },
    nuptk: { with_nuptk: withNuptk, without_nuptk: total - withNuptk, coverage: { count: withNuptk, percentage: percent(withNuptk, total) } },
    data_quality: {
      fields: [...dataQuality, { field: "overall", present: presentFields, missing: eligibleFields - presentFields, coverage: percent(presentFields, eligibleFields) }],
      duplicate_identity_count: duplicateIdentityCount,
      invalid_identifier_count: invalidIdentifierCount,
      unmapped_position_count: total - classifiedTitles,
      unresolved_import_conflict_count: unresolvedImportConflictCount,
    },
    positions: [...positionGroups].sort(([a], [b]) => a.localeCompare(b)).map(([label, value]) => ({ label, count: value.count, active_count: value.active, percentage: percent(value.count, total) })),
    joining: distribution(joinYears, total),
  };
}

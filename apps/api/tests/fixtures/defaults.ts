import type { Database } from "bun:sqlite";

// Fixture data required by current tests that formerly invoked legacy init_db.
// This installs no schema and is not application startup/migration authority.
export function seedFixtureDefaults(client: Database): void {
  seedGradeDefaults(client);
  seedReportDefaults(client);
}

export function seedGradeDefaults(client: Database): void {
  for (const [name, type] of [["kuis", "sumatif"], ["tes", "sumatif"], ["total", "sumatif"], ["total", "formatif"]]) client.run("INSERT INTO assessment_components (name,assessment_type,subject_id) VALUES (?,?,NULL)", [name!, type!]);
  const primary = Number(client.run("INSERT INTO jenjangs (name) VALUES ('Primary')").lastInsertRowid);
  client.run("INSERT INTO academic_years (label,start_date,end_date,status,is_default) VALUES ('2025/2026','2025-07-01','2026-06-30','active',1)");
  client.run("INSERT INTO subjects (name,jenjang_id,supports_sumatif,supports_formatif) VALUES ('Language',?,1,1)", [primary]);
}

function seedReportDefaults(client: Database): void {
  const allPages = ["executive_summary", "attendance", "lateness", "grade_class", "grade_subject", "grade_student", "below_kkm", "interventions", "historical_trends", "forecast", "intervention_impact", "executive_insights", "data_quality", "metadata"];
  const allCharts = ["attendance", "lateness", "grade_class", "grade_subject", "below_kkm", "interventions", "historical_trends", "forecast", "intervention_impact"];
  const allSheets = ["README", "Config", "Charts", "Attendance_Data", "Lateness_Data", "Grade_Class_Data", "Grade_Subject_Data", "Grade_Student_Data", "Below_KKM_Data", "Interventions_Data", "Insights", "Trend_Attendance_Data", "Trend_Lateness_Data", "Trend_Grades_Data", "Trend_Interventions_Data", "Forecast_Data", "Trend_Insights", "Intervention_Impact_Data", "Intervention_Impact_Summary", "Risk_Students_Data", "Owner_Workload_Data"];
  const templates = [
    { name: "Full Management Review", description: "Complete management report with all sections enabled.", type: "management_summary", format: "both", default: 1, pages: allPages, charts: allCharts, sheets: allSheets },
    { name: "Attendance & Lateness Review", description: "Focused attendance and lateness report.", type: "attendance_review", format: "both", default: 0,
      pages: ["executive_summary", "attendance", "lateness", "historical_trends", "executive_insights", "data_quality"], charts: ["attendance", "lateness", "historical_trends"],
      sheets: ["README", "Config", "Charts", "Attendance_Data", "Lateness_Data", "Trend_Attendance_Data", "Trend_Lateness_Data", "Trend_Insights", "Insights"] },
    { name: "Academic Risk Review", description: "Academic risk, below-KKM, and intervention focused report.", type: "academic_review", format: "both", default: 0,
      pages: ["executive_summary", "grade_class", "grade_subject", "grade_student", "below_kkm", "interventions", "intervention_impact", "executive_insights", "data_quality"], charts: ["grade_class", "grade_subject", "below_kkm", "interventions", "intervention_impact"],
      sheets: ["README", "Config", "Charts", "Grade_Class_Data", "Grade_Subject_Data", "Grade_Student_Data", "Below_KKM_Data", "Interventions_Data", "Intervention_Impact_Data", "Intervention_Impact_Summary", "Risk_Students_Data", "Owner_Workload_Data", "Insights"] },
    { name: "Editable Excel Workbook", description: "Excel-focused preset with editable source sheets and charts.", type: "management_summary", format: "excel", default: 0, pages: allPages, charts: allCharts, sheets: allSheets },
  ];
  const visibility = (keys: string[]) => JSON.stringify(Object.fromEntries(keys.map(key => [key, true])));
  for (const template of templates) client.run("INSERT INTO report_templates (name,description,template_type,output_format,is_default,is_active,page_order_json,section_visibility_json,chart_visibility_json,excel_sheet_visibility_json,default_filters_json,export_options_json) VALUES (?,?,?,?,?,1,?,?,?,?, '{}','{}')", [template.name, template.description, template.type, template.format, template.default, JSON.stringify(template.pages), visibility(template.pages), visibility(template.charts), visibility(template.sheets)]);
  client.run("INSERT INTO report_branding_configs (school_name,foundation_name,report_header_title,report_subtitle,primary_color,secondary_color,accent_color,logo_label,footer_text,prepared_by,is_default) VALUES (?,?,?,?,?,?,?,?,?,?,1)", ["EDELWEISS SCHOOL", "Edelweiss Education Foundation", "Management Analytics Report", "Attendance, lateness, grades, trends, and intervention analytics", "#1E3A8A", "#0F172A", "#F97316", "School Logo", "Prepared for school leadership review", "OperatorOS"]);
}

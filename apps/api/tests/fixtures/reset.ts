import { randomUUID } from "node:crypto";
import { openDatabase } from "@operatoros/db";
import { createAccountFixture } from "./accounts";

export function createResetFixture(path: string): void {
  createAccountFixture(path, "golden-active");
  const handle = openDatabase(path), db = handle.client;
  try {
    db.transaction(() => {
      db.exec(`
        INSERT INTO academic_years (label,start_date,end_date,status,is_default) VALUES ('2026/2027-reset-test','2026-07-01','2027-06-30','active',1);
        INSERT INTO jenjangs (name,code,level,active) VALUES ('SMP','RESET-SMP','junior',1);
        INSERT INTO academic_programs (jenjang_id,name,active) VALUES (1,'RESET-MAIN',1);
        INSERT INTO academic_grades (jenjang_id,program_id,name,sequence_number,active) VALUES (1,1,'Reset Grade 7',1,1);
        INSERT INTO academic_classes (academic_year_id,grade_id,class_name,section_code,active) VALUES (1,1,'Reset 7A','A',1);
      `);
      const master = randomUUID();
      db.run("INSERT INTO student_masters (id,full_name,normalized_name,student_status) VALUES (?,'Synthetic Reset Student','synthetic reset student','active')", [master]);
      db.run("INSERT INTO students (id,name,jenjang,class_name) VALUES (71001,'Synthetic Reset Student','SMP','Reset 7A')");
      db.run("INSERT INTO student_enrollments (student_id,student_master_id,academic_year_id,jenjang_id,academic_class_id,class_name,class_assigned,effective_from,lifecycle_state) VALUES (71001,?,1,1,1,'Reset 7A',1,'2026-07-01','ACTIVE')", [master]);
      db.exec(`
        INSERT INTO subjects (name,jenjang_id,supports_sumatif,supports_formatif) VALUES ('Reset Math',1,1,1);
        INSERT INTO assessment_components (name,assessment_type,subject_id) VALUES ('Reset Exam','sumatif',1);
        INSERT INTO student_subject_grades (enrollment_id,subject_id,component_id,score) VALUES (1,1,1,88);
        INSERT INTO academic_interventions (student_id,enrollment_id,academic_year_id,jenjang_id,subject_id,student_name,subject_name,effective_threshold,threshold_source,status,priority) VALUES (71001,1,1,1,1,'Synthetic Reset Student','Reset Math',75,'test','open','medium');
        INSERT INTO attendance (student_id,date,check_in,check_out,late_duration,late_source,is_absent,status) VALUES (71001,'2026-08-26','07:30:00','15:00:00',0,'test',0,'on-time');
        INSERT INTO attendance_calendar_weekday_rules (academic_year_id,jenjang_id,weekday,expectation) VALUES (1,1,1,'EXPECTED');
        INSERT INTO backup_scheduler_config (updated_at) VALUES (CURRENT_TIMESTAMP);
        INSERT INTO report_branding_configs (school_name,report_header_title,report_subtitle,primary_color,secondary_color,accent_color,footer_text,prepared_by,is_default) VALUES ('Synthetic School','Synthetic Report','Test',' #000000','#111111','#222222','Synthetic footer','Test admin',1);
        INSERT INTO report_templates (name,template_type,output_format,is_default,is_active,page_order_json,section_visibility_json,chart_visibility_json,excel_sheet_visibility_json,default_filters_json,export_options_json) VALUES ('Synthetic template','attendance','pdf',0,1,'[]','{}','{}','{}','{}','{}');
        INSERT INTO staff_job_title_mappings (raw_title,normalized_title,status) VALUES ('Synthetic role','synthetic-role','APPROVED');
      `);
    })();
  } finally { handle.close(); }
}

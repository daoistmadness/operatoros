export interface AcademicYear {
  id: number;
  label: string;
  start_date: string;
  end_date: string;
  status: "upcoming" | "active" | "closed";
  is_default: boolean;
}

export interface Subject {
  id: number;
  name: string;
  jenjang_id: number;
  supports_sumatif: boolean;
  supports_formatif: boolean;
}

export interface AssessmentComponent {
  id: number;
  name: string;
  assessment_type: "sumatif" | "formatif";
  subject_id: number | null;
}

export interface GradeLineItem {
  subject_id: number;
  component_id: number;
  score: number | null;
}

export interface GradeGridSaveRequest {
  enrollment_id: number;
  grades: GradeLineItem[];
}

export interface GradeSaveResult {
  status: "success";
  saved: number;
}

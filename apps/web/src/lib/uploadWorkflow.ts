export type UploadAction =
  | "CREATE"
  | "UPDATE"
  | "DIFFERENCE"
  | "UNCHANGED"
  | "CONFLICT"
  | "INVALID"
  | "BLOCKED";

export type UploadRowViewModel = {
  key: number;
  classification: string;
  label: string;
  explanation: string;
  action: UploadAction;
  selectable: boolean;
  recommendedAction: string;
  disabledReason: string;
  technicalCode?: string;
};

type Rule = Omit<UploadRowViewModel, "key" | "classification" | "technicalCode">;

const attendanceRules: Record<string, Rule> = {
  NEW: {
    label: "New attendance",
    explanation: "No attendance record exists for this student and date.",
    action: "CREATE",
    selectable: true,
    recommendedAction: "Select this row to create the attendance record.",
    disabledReason: "",
  },
  DIFFERENCE: {
    label: "Attendance change",
    explanation: "The device record differs from the stored attendance record.",
    action: "DIFFERENCE",
    selectable: true,
    recommendedAction: "Review the before and after values, then select this row to apply the change.",
    disabledReason: "",
  },
  UNCHANGED: {
    label: "Unchanged",
    explanation: "The device record matches the stored attendance record.",
    action: "UNCHANGED",
    selectable: true,
    recommendedAction: "No data change is needed; include only if you want it recorded in this import.",
    disabledReason: "",
  },
  CONFLICT: {
    label: "Conflict",
    explanation: "This row has an identity or duplicate-record conflict.",
    action: "CONFLICT",
    selectable: false,
    recommendedAction: "Resolve the identity or source-data conflict, then upload the workbook again.",
    disabledReason: "Conflict rows cannot be imported.",
  },
  INVALID: {
    label: "Invalid row",
    explanation: "A required value is missing or has an unsupported format.",
    action: "INVALID",
    selectable: false,
    recommendedAction: "Correct the source row and upload the workbook again.",
    disabledReason: "Invalid rows cannot be imported.",
  },
};

const rosterRules: Record<string, Rule> = {
  CREATE_NEW_MASTER: {
    label: "Create student",
    explanation: "A new canonical student, device identity, and enrollment will be created.",
    action: "CREATE",
    selectable: true,
    recommendedAction: "Verify the identity and enrollment fields before selecting this row.",
    disabledReason: "",
  },
  CREATE_ENROLLMENT: {
    label: "Create enrollment",
    explanation: "The student was safely matched and a new enrollment will be created.",
    action: "CREATE",
    selectable: true,
    recommendedAction: "Verify the target academic year and class before selecting this row.",
    disabledReason: "",
  },
  POSSIBLE_DUPLICATE: {
    label: "Ambiguous match",
    explanation: "More than one identity may match this roster row.",
    action: "CONFLICT",
    selectable: false,
    recommendedAction: "Review stable identifiers such as NIPD, NISN, NIK, birth date, or device ID.",
    disabledReason: "Ambiguous identity matches cannot be imported.",
  },
  MISSING_JENJANG: {
    label: "Missing level",
    explanation: "The roster level does not match active canonical master data.",
    action: "BLOCKED",
    selectable: false,
    recommendedAction: "Use an active canonical Jenjang value and upload the workbook again.",
    disabledReason: "Rows with a missing Jenjang reference cannot be imported.",
  },
  MISSING_CLASS: {
    label: "Missing class",
    explanation: "The program or class does not match active approved master data.",
    action: "BLOCKED",
    selectable: false,
    recommendedAction: "Correct the program or class reference and upload the workbook again.",
    disabledReason: "Rows with a missing class reference cannot be imported.",
  },
  INVALID: {
    label: "Invalid row",
    explanation: "The row is incomplete, duplicated, inactive, or otherwise invalid.",
    action: "INVALID",
    selectable: false,
    recommendedAction: "Review the validation message, correct the workbook, and try again.",
    disabledReason: "Invalid roster rows cannot be imported.",
  },
};

const unknownRule: Rule = {
  label: "Blocked",
  explanation: "This row cannot currently be imported.",
  action: "BLOCKED",
  selectable: false,
  recommendedAction: "Review the technical details or contact support.",
  disabledReason: "This classification is not recognized and is blocked for safety.",
};

export function technicalCode(value?: string | null): string | undefined {
  const match = value?.match(/^([A-Z][A-Z0-9_]+):/);
  return match?.[1];
}

export function attendanceRowView(row: any): UploadRowViewModel {
  const rule = attendanceRules[row.classification] || unknownRule;
  const code = technicalCode(row.validation_error);
  if (code === "DEVICE_IDENTITY_UNMATCHED") {
    return {
      ...rule,
      key: row.id,
      classification: row.classification,
      technicalCode: code,
      explanation: `Device ID ${row.student_identifier || "unknown"} is not linked to an active student.`,
      recommendedAction: "Import or update the student roster, then link this device ID before retrying.",
      disabledReason: "This device ID has no active student identity.",
    };
  }
  return { ...rule, key: row.id, classification: row.classification, technicalCode: code };
}

export function rosterRowView(row: any): UploadRowViewModel {
  const rule = rosterRules[row.classification] || unknownRule;
  return { ...rule, key: row.preview_row_id, classification: row.classification };
}

export function eligibleIds(rows: any[], adapter: (row: any) => UploadRowViewModel): number[] {
  return rows.map(adapter).filter((row) => row.selectable).map((row) => row.key);
}

export function safeSelectedIds(
  rows: any[],
  selected: number[],
  adapter: (row: any) => UploadRowViewModel,
): number[] {
  const allowed = new Set(eligibleIds(rows, adapter));
  return Array.from(new Set(selected)).filter((id) => allowed.has(id));
}

export function selectionState(eligible: number[], selected: number[]) {
  const selectedEligible = selected.filter((id) => eligible.includes(id)).length;
  return {
    checked: eligible.length > 0 && selectedEligible === eligible.length,
    indeterminate: selectedEligible > 0 && selectedEligible < eligible.length,
  };
}

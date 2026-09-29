import type {
  LegacyAbsenceReasonsResponse,
  ManualAbsenceMonthlyResponse,
  ManualAbsenceLedgerActionRequest,
  ManualAbsenceLedgerActionResponse,
  ManualAbsenceLedgerReopenRequest,
  ManualAbsenceSaveRequest,
  ManualAbsenceStudentTotalsResponse,
} from "@operatoros/contracts/reports";
import { apiRequest } from "../lib/api/client";

export async function getMonthlyClassAbsenceTotals(academicYearId: number, month: string) {
  return (await apiRequest<ManualAbsenceMonthlyResponse>({
    path: "/api/config/absence-reasons",
    params: { academic_year_id: academicYearId, month },
  })).data;
}

export async function getMonthlyClassAbsenceStudentTotals(academicYearId: number, month: string, classId: number) {
  return (await apiRequest<ManualAbsenceStudentTotalsResponse>({
    path: "/api/config/absence-reasons/students",
    params: { academic_year_id: academicYearId, month, class_id: classId },
  })).data;
}

export async function getLegacyAbsenceReasons(month: string) {
  return (await apiRequest<LegacyAbsenceReasonsResponse>({
    path: "/api/config/absence-reasons/legacy",
    params: { month },
  })).data;
}

export async function saveMonthlyClassAbsenceTotals(payload: ManualAbsenceSaveRequest) {
  return (await apiRequest<{ inserted: number; updated: number; total: number; state: "OPEN" }>({
    path: "/api/config/absence-reasons/bulk",
    method: "POST",
    body: payload,
  })).data;
}

export async function submitMonthlyClassAbsenceLedger(payload: ManualAbsenceLedgerActionRequest) {
  return (await apiRequest<ManualAbsenceLedgerActionResponse>({
    path: "/api/config/absence-reasons/submit", method: "POST", body: payload,
  })).data;
}

export async function reopenMonthlyClassAbsenceLedger(payload: ManualAbsenceLedgerReopenRequest) {
  return (await apiRequest<ManualAbsenceLedgerActionResponse>({
    path: "/api/config/absence-reasons/reopen", method: "POST", body: payload,
  })).data;
}

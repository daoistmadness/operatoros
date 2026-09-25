import type {
  ManualAbsenceMonthlyResponse,
  ManualAbsenceSaveRequest,
} from "@operatoros/contracts/reports";
import { apiRequest } from "../lib/api/client";

export async function getMonthlyClassAbsenceTotals(academicYearId: number, month: string) {
  return (await apiRequest<ManualAbsenceMonthlyResponse>({
    path: "/api/config/absence-reasons",
    params: { academic_year_id: academicYearId, month },
  })).data;
}

export async function saveMonthlyClassAbsenceTotals(payload: ManualAbsenceSaveRequest) {
  return (await apiRequest<{ inserted: number; updated: number; total: number }>({
    path: "/api/config/absence-reasons/bulk",
    method: "POST",
    body: payload,
  })).data;
}

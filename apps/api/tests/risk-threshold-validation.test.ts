import { describe, expect, it } from "bun:test";
import type { StudentIndicatorInsightsResponse } from "@operatoros/contracts/analytics";
import {
  deidentifyIndicatorResponse,
  evaluateThreshold,
  evaluateThresholdGrid,
  summarizeDistribution,
  summarizeCalibrationAgreement,
  type ValidationRow,
} from "../src/analytics/risk-threshold-validation";

function row(caseId: string, humanOutcome: ValidationRow["humanOutcome"], attendanceRate: number | null, alfaRate = 0): ValidationRow {
  return {
    caseId,
    jenjang: "SMP",
    reviewDate: "2026-08-31",
    reviewWindow: { kind: "rolling_4w", anchorDate: "2026-08-30", currentStart: "2026-08-03", currentEnd: "2026-08-30", previousStart: "2026-07-06", previousEnd: "2026-08-02" },
    humanOutcome,
    indicatorDataAvailability: { attendance: "available", comparison: "available", academic: "available" },
    indicators: { attendance_rate: attendanceRate, attendance_delta: null, tardiness_rate: null, tardiness_delta: null, alfa_rate: alfaRate, alfa_delta: null, academic_average: null, academic_participation: null },
  };
}

describe("risk threshold validation harness", () => {
  it("strips identity fields while preserving canonical Stage 2 values", () => {
    // SOFTWARE_TEST_ONLY: validates extraction safety; this is not threshold evidence.
    const response = {
      scope: { academicYearId: 1, academicYearLabel: "2026/2027", jenjangId: 1, classId: null },
      window: { kind: "rolling_4w", anchorDate: "2026-08-30", currentStart: "2026-08-03", currentEnd: "2026-08-30", previousStart: "2026-07-06", previousEnd: "2026-08-02", currentEligibleDays: 28, previousEligibleDays: 28, comparison: "comparable" },
      totalStudents: 1, page: 1, pageSize: 25,
      rows: [{
        studentId: "internal-only", studentName: "software-test-only", className: "7A", jenjang: "SMP",
        attendanceRate: { id: "attendance_rate", label: "Attendance rate", domain: "attendance", unit: "percent", current: 80, previous: 90, delta: -10, direction: "down", currentSampleSize: 10, previousSampleSize: 10, dataStatus: "available" },
        tardinessRate: null, alfaRate: null,
        academicAverage: { id: "academic_average", label: "Academic average", domain: "academic", unit: "score", current: 70, previous: null, delta: null, direction: "insufficient_data", currentSampleSize: 2, previousSampleSize: 0, dataStatus: "insufficient_data" },
        academicParticipation: { id: "academic_participation", label: "Academic participation", domain: "academic", unit: "percent", current: 50, previous: null, delta: null, direction: "insufficient_data", currentSampleSize: 1, previousSampleSize: 0, dataStatus: "insufficient_data" },
        dataAvailability: { attendance: "available", comparison: "available", academic: "available" },
      }],
      indicatorDefinitions: [], limitations: [],
    } as StudentIndicatorInsightsResponse;

    const rows = deidentifyIndicatorResponse(response, [{ caseId: "CASE-001", reviewDate: "2026-08-31", humanOutcome: "FOLLOW_UP_WARRANTED" }]);
    expect(rows[0]).toMatchObject({ caseId: "CASE-001", humanOutcome: "FOLLOW_UP_WARRANTED", indicators: { attendance_rate: 80, attendance_delta: -10, academic_average: 70, academic_participation: 50 } });
    expect(JSON.stringify(rows)).not.toContain("studentId");
    expect(JSON.stringify(rows)).not.toContain("software-test-only");
  });

  it("evaluates lower-is-concerning thresholds and tracks uncertain or missing cases", () => {
    const rows = [row("CASE-001", "FOLLOW_UP_WARRANTED", 80), row("CASE-002", "FOLLOW_UP_WARRANTED", 95), row("CASE-003", "NO_FOLLOW_UP_IDENTIFIED", 70), row("CASE-004", "NO_FOLLOW_UP_IDENTIFIED", 90), row("CASE-005", "UNCERTAIN", 60), row("CASE-006", "FOLLOW_UP_WARRANTED", null)];
    expect(evaluateThreshold(rows, "attendance_rate", 80, "lower_is_concerning")).toMatchObject({ evaluableN: 4, positiveN: 2, negativeN: 2, uncertainN: 1, missingN: 1, unevaluableN: 2, tp: 1, fp: 1, tn: 1, fn: 1, precision: 0.5, recall: 0.5, specificity: 0.5, negativePredictiveValue: 0.5, prevalence: 0.5 });
  });

  it("evaluates higher-is-concerning thresholds, distributions, grids, and zero denominators", () => {
    const rows = [row("CASE-001", "FOLLOW_UP_WARRANTED", 80, 20), row("CASE-002", "FOLLOW_UP_WARRANTED", 95, 50), row("CASE-003", "NO_FOLLOW_UP_IDENTIFIED", 70, 70), row("CASE-004", "NO_FOLLOW_UP_IDENTIFIED", 90, 30)];
    expect(evaluateThreshold(rows, "alfa_rate", 50, "higher_is_concerning")).toMatchObject({ tp: 1, fp: 1, tn: 1, fn: 1, precision: 0.5, recall: 0.5, specificity: 0.5 });
    expect(summarizeDistribution(rows, "alfa_rate", "FOLLOW_UP_WARRANTED")).toEqual({ caseN: 2, n: 2, missingN: 0, min: 20, q1: 27.5, median: 35, q3: 42.5, max: 50 });
    expect(evaluateThresholdGrid(rows, "alfa_rate", [30, 50, 70], "higher_is_concerning").map((value) => value.threshold)).toEqual([30, 50, 70]);
    expect(evaluateThreshold([row("CASE-001", "FOLLOW_UP_WARRANTED", 80)], "attendance_rate", 80, "lower_is_concerning")).toMatchObject({ precision: 1, recall: 1, specificity: null, negativePredictiveValue: null, prevalence: 1 });
  });

  it("reports independent calibration agreement without collapsing reviewer labels", () => {
    // SOFTWARE_TEST_ONLY: validates calibration math; this is not real-case evidence.
    expect(summarizeCalibrationAgreement([
      { caseId: "CASE-001", reviewerA: "FOLLOW_UP_WARRANTED", reviewerB: "FOLLOW_UP_WARRANTED" },
      { caseId: "CASE-002", reviewerA: "FOLLOW_UP_WARRANTED", reviewerB: "NO_FOLLOW_UP_IDENTIFIED" },
      { caseId: "CASE-003", reviewerA: "UNCERTAIN", reviewerB: "UNCERTAIN" },
      { caseId: "CASE-004", reviewerA: "UNCERTAIN", reviewerB: "NO_FOLLOW_UP_IDENTIFIED" },
    ])).toEqual({ caseN: 4, exactAgreementN: 2, disagreementN: 2, uncertainInvolvedN: 2, percentAgreement: 0.5 });
  });
});

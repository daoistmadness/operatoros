import type { StudentIndicatorInsightsResponse } from "@operatoros/contracts/analytics";

export const VALIDATION_INDICATORS = [
  "attendance_rate",
  "attendance_delta",
  "tardiness_rate",
  "tardiness_delta",
  "alfa_rate",
  "alfa_delta",
  "academic_average",
  "academic_participation",
] as const;

export type ValidationIndicator = typeof VALIDATION_INDICATORS[number];
export type HumanOutcome = "FOLLOW_UP_WARRANTED" | "NO_FOLLOW_UP_IDENTIFIED" | "UNCERTAIN";
export type ThresholdDirection = "lower_is_concerning" | "higher_is_concerning";
type IndicatorResponseRow = StudentIndicatorInsightsResponse["rows"][number];
type IndicatorWindow = StudentIndicatorInsightsResponse["window"];

export type ValidationReviewWindow = Pick<
  IndicatorWindow,
  "kind" | "anchorDate" | "currentStart" | "currentEnd" | "previousStart" | "previousEnd"
>;

export type ValidationIndicatorValues = Record<ValidationIndicator, number | null>;

export interface HumanReviewedCase {
  caseId: string;
  reviewDate: string;
  humanOutcome: HumanOutcome;
}

export interface ValidationRow {
  caseId: string;
  jenjang: string | null;
  reviewDate: string;
  reviewWindow: ValidationReviewWindow;
  humanOutcome: HumanOutcome;
  indicatorDataAvailability: IndicatorResponseRow["dataAvailability"];
  indicators: ValidationIndicatorValues;
}

export interface DistributionSummary {
  caseN: number;
  n: number;
  missingN: number;
  min: number | null;
  q1: number | null;
  median: number | null;
  q3: number | null;
  max: number | null;
}

export interface ThresholdEvaluation {
  indicator: ValidationIndicator;
  threshold: number;
  direction: ThresholdDirection;
  evaluableN: number;
  positiveN: number;
  negativeN: number;
  uncertainN: number;
  missingN: number;
  unevaluableN: number;
  tp: number;
  fp: number;
  tn: number;
  fn: number;
  prevalence: number | null;
  precision: number | null;
  recall: number | null;
  specificity: number | null;
  negativePredictiveValue: number | null;
}

export interface CalibrationReviewPair {
  caseId: string;
  reviewerA: HumanOutcome;
  reviewerB: HumanOutcome;
}

export interface CalibrationAgreement {
  caseN: number;
  exactAgreementN: number;
  disagreementN: number;
  uncertainInvolvedN: number;
  percentAgreement: number | null;
}

const HUMAN_OUTCOMES = new Set<HumanOutcome>([
  "FOLLOW_UP_WARRANTED",
  "NO_FOLLOW_UP_IDENTIFIED",
  "UNCERTAIN",
]);

const readers: Record<ValidationIndicator, (row: IndicatorResponseRow) => number | null> = {
  attendance_rate: (row) => row.attendanceRate?.current ?? null,
  attendance_delta: (row) => row.attendanceRate?.delta ?? null,
  tardiness_rate: (row) => row.tardinessRate?.current ?? null,
  tardiness_delta: (row) => row.tardinessRate?.delta ?? null,
  alfa_rate: (row) => row.alfaRate?.current ?? null,
  alfa_delta: (row) => row.alfaRate?.delta ?? null,
  academic_average: (row) => row.academicAverage.current,
  academic_participation: (row) => row.academicParticipation.current,
};

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function assertFiniteOrNull(value: number | null, label: string): void {
  if (value !== null && !Number.isFinite(value)) throw new Error(`${label} must be finite or null`);
}

function assertHumanReviewedCase(value: HumanReviewedCase): void {
  if (!/^CASE-\d{3,}$/.test(value.caseId)) throw new Error(`Invalid de-identified case ID: ${value.caseId}`);
  if (!isIsoDate(value.reviewDate)) throw new Error(`Invalid review date for ${value.caseId}`);
  if (!HUMAN_OUTCOMES.has(value.humanOutcome)) throw new Error(`Invalid human outcome for ${value.caseId}`);
}

export function deidentifyIndicatorResponse(
  response: StudentIndicatorInsightsResponse,
  cases: readonly HumanReviewedCase[],
): ValidationRow[] {
  if (response.rows.length !== cases.length) throw new Error("Case metadata must match canonical indicator rows exactly");
  const seen = new Set<string>();
  cases.forEach((value) => {
    assertHumanReviewedCase(value);
    if (!seen.add(value.caseId)) throw new Error(`Duplicate de-identified case ID: ${value.caseId}`);
  });

  return response.rows.map((row, index) => {
    const reviewed = cases[index]!;
    const indicators = Object.fromEntries(
      VALIDATION_INDICATORS.map((indicator) => [indicator, readers[indicator](row)]),
    ) as ValidationIndicatorValues;
    return {
      caseId: reviewed.caseId,
      jenjang: row.jenjang,
      reviewDate: reviewed.reviewDate,
      reviewWindow: {
        kind: response.window.kind,
        anchorDate: response.window.anchorDate,
        currentStart: response.window.currentStart,
        currentEnd: response.window.currentEnd,
        previousStart: response.window.previousStart,
        previousEnd: response.window.previousEnd,
      },
      humanOutcome: reviewed.humanOutcome,
      indicatorDataAvailability: { ...row.dataAvailability },
      indicators,
    };
  });
}

export function validateValidationRows(rows: readonly ValidationRow[]): void {
  const seen = new Set<string>();
  for (const row of rows) {
    if (!/^CASE-\d{3,}$/.test(row.caseId)) throw new Error(`Invalid de-identified case ID: ${row.caseId}`);
    if (!seen.add(row.caseId)) throw new Error(`Duplicate de-identified case ID: ${row.caseId}`);
    if (!isIsoDate(row.reviewDate)) throw new Error(`Invalid review date for ${row.caseId}`);
    if (!HUMAN_OUTCOMES.has(row.humanOutcome)) throw new Error(`Invalid human outcome for ${row.caseId}`);
    for (const indicator of VALIDATION_INDICATORS) assertFiniteOrNull(row.indicators[indicator], `${row.caseId}.${indicator}`);
  }
}

export function summarizeCalibrationAgreement(
  reviews: readonly CalibrationReviewPair[],
): CalibrationAgreement {
  const seen = new Set<string>();
  let exactAgreementN = 0;
  let uncertainInvolvedN = 0;

  for (const review of reviews) {
    if (!/^CASE-\d{3,}$/.test(review.caseId)) throw new Error(`Invalid de-identified case ID: ${review.caseId}`);
    if (!seen.add(review.caseId)) throw new Error(`Duplicate de-identified case ID: ${review.caseId}`);
    if (!HUMAN_OUTCOMES.has(review.reviewerA) || !HUMAN_OUTCOMES.has(review.reviewerB)) {
      throw new Error(`Invalid calibration outcome for ${review.caseId}`);
    }
    if (review.reviewerA === review.reviewerB) exactAgreementN += 1;
    if (review.reviewerA === "UNCERTAIN" || review.reviewerB === "UNCERTAIN") uncertainInvolvedN += 1;
  }

  const caseN = reviews.length;
  return {
    caseN,
    exactAgreementN,
    disagreementN: caseN - exactAgreementN,
    uncertainInvolvedN,
    percentAgreement: ratio(exactAgreementN, caseN),
  };
}

function quantile(values: readonly number[], probability: number): number | null {
  if (values.length === 0) return null;
  const position = (values.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return values[lower]!;
  return values[lower]! + (values[upper]! - values[lower]!) * (position - lower);
}

export function summarizeDistribution(
  rows: readonly ValidationRow[],
  indicator: ValidationIndicator,
  humanOutcome: Exclude<HumanOutcome, "UNCERTAIN">,
): DistributionSummary {
  validateValidationRows(rows);
  const selected = rows.filter((row) => row.humanOutcome === humanOutcome);
  const values = selected
    .map((row) => row.indicators[indicator])
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);
  return {
    caseN: selected.length,
    n: values.length,
    missingN: selected.length - values.length,
    min: values[0] ?? null,
    q1: quantile(values, 0.25),
    median: quantile(values, 0.5),
    q3: quantile(values, 0.75),
    max: values.at(-1) ?? null,
  };
}

export function evaluateThreshold(
  rows: readonly ValidationRow[],
  indicator: ValidationIndicator,
  threshold: number,
  direction: ThresholdDirection,
): ThresholdEvaluation {
  validateValidationRows(rows);
  if (!Number.isFinite(threshold)) throw new Error("Threshold must be finite");

  let positiveN = 0;
  let negativeN = 0;
  let uncertainN = 0;
  let missingN = 0;
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;

  for (const row of rows) {
    if (row.humanOutcome === "UNCERTAIN") {
      uncertainN += 1;
      continue;
    }
    const value = row.indicators[indicator];
    if (value === null) {
      missingN += 1;
      continue;
    }
    const predictedPositive = direction === "lower_is_concerning" ? value <= threshold : value >= threshold;
    if (row.humanOutcome === "FOLLOW_UP_WARRANTED") {
      positiveN += 1;
      if (predictedPositive) tp += 1;
      else fn += 1;
    } else {
      negativeN += 1;
      if (predictedPositive) fp += 1;
      else tn += 1;
    }
  }

  const unevaluableN = uncertainN + missingN;
  return {
    indicator,
    threshold,
    direction,
    evaluableN: positiveN + negativeN,
    positiveN,
    negativeN,
    uncertainN,
    missingN,
    unevaluableN,
    tp,
    fp,
    tn,
    fn,
    prevalence: ratio(positiveN, positiveN + negativeN),
    precision: ratio(tp, tp + fp),
    recall: ratio(tp, tp + fn),
    specificity: ratio(tn, tn + fp),
    negativePredictiveValue: ratio(tn, tn + fn),
  };
}

export function evaluateThresholdGrid(
  rows: readonly ValidationRow[],
  indicator: ValidationIndicator,
  thresholds: readonly number[],
  direction: ThresholdDirection,
): ThresholdEvaluation[] {
  const seen = new Set<number>();
  for (const threshold of thresholds) {
    if (!Number.isFinite(threshold)) throw new Error("Thresholds must be finite");
    if (!seen.add(threshold)) throw new Error(`Duplicate threshold: ${threshold}`);
  }
  return thresholds.map((threshold) => evaluateThreshold(rows, indicator, threshold, direction));
}

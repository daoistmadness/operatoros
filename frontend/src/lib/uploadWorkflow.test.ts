import { describe, expect, it } from "vitest";
import {
  attendanceRowView,
  eligibleIds,
  rosterRowView,
  safeSelectedIds,
  selectionState,
} from "./uploadWorkflow";

describe("attendance upload classification adapter", () => {
  it.each(["NEW", "DIFFERENCE", "UNCHANGED"])("allows backend-eligible %s rows", (classification) => {
    expect(attendanceRowView({ id: 1, classification }).selectable).toBe(true);
  });

  it.each(["CONFLICT", "INVALID", "FUTURE_STATUS"])("fails closed for %s rows", (classification) => {
    const view = attendanceRowView({ id: 1, classification });
    expect(view.selectable).toBe(false);
    expect(view.disabledReason).not.toBe("");
  });

  it("turns an unmatched device code into operator guidance", () => {
    const view = attendanceRowView({
      id: 1,
      classification: "CONFLICT",
      student_identifier: "20000064",
      validation_error: "DEVICE_IDENTITY_UNMATCHED: no active mapping",
    });
    expect(view.explanation).toContain("Device ID 20000064");
    expect(view.recommendedAction).toContain("student roster");
    expect(view.technicalCode).toBe("DEVICE_IDENTITY_UNMATCHED");
  });
});

describe("roster upload classification adapter", () => {
  it.each(["CREATE_NEW_MASTER", "CREATE_ENROLLMENT"])("allows %s", (classification) => {
    expect(rosterRowView({ preview_row_id: 1, classification }).selectable).toBe(true);
  });

  it.each(["POSSIBLE_DUPLICATE", "MISSING_JENJANG", "MISSING_CLASS", "INVALID", "NO_CHANGE", "FUTURE_STATUS"])("blocks %s", (classification) => {
    expect(rosterRowView({ preview_row_id: 1, classification }).selectable).toBe(false);
  });
});

describe("safe bulk selection", () => {
  const rows = [
    { id: 1, classification: "NEW" },
    { id: 2, classification: "CONFLICT" },
    { id: 3, classification: "DIFFERENCE" },
    { id: 4, classification: "FUTURE_STATUS" },
  ];

  it("selects eligible stable IDs only", () => {
    expect(eligibleIds(rows, attendanceRowView)).toEqual([1, 3]);
    expect(safeSelectedIds(rows, [1, 2, 3, 4, 3], attendanceRowView)).toEqual([1, 3]);
  });

  it("reports checked and indeterminate header states", () => {
    expect(selectionState([1, 3], [])).toEqual({ checked: false, indeterminate: false });
    expect(selectionState([1, 3], [1])).toEqual({ checked: false, indeterminate: true });
    expect(selectionState([1, 3], [1, 3])).toEqual({ checked: true, indeterminate: false });
  });
});

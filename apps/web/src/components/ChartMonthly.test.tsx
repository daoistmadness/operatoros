import { expect, it } from "vitest";
import { monthLabel } from "./ChartMonthly";

it("formats date-only month labels without applying the browser timezone", () => {
  expect(monthLabel("2026-07")).toBe("Jul 26");
  expect(monthLabel("2027-01")).toBe("Jan 27");
});

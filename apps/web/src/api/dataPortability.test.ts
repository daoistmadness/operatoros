import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../lib/api/client";
import { previewExport } from "./dataPortability";

vi.mock("../lib/api/client", () => ({ apiRequest: vi.fn() }));

describe("data portability API", () => {
  beforeEach(() => vi.mocked(apiRequest).mockReset());

  it("sends export preview data as a JSON object", async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      data: {
        dataset: "student_roster",
        format_version: "operatoros_csv_v1",
        estimated_row_count: 1,
        sensitive_fields_included: false,
        allowed: true,
        warnings: [],
        maximum_permitted_rows: 5000,
      },
      status: 200,
      headers: {},
    });

    await previewExport({ dataset: "student_roster", include_sensitive_fields: false });

    expect(apiRequest).toHaveBeenCalledWith({
      path: "/api/data-portability/exports/preview",
      method: "POST",
      body: { dataset: "student_roster", include_sensitive_fields: false },
    });
  });
});

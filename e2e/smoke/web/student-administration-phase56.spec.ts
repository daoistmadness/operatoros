import { expect, test } from "../../../apps/web/node_modules/@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { PDFDocument } from "../../../apps/api/node_modules/pdf-lib";

const username = process.env.OPERATOROS_E2E_ADMIN_USERNAME!;
const password = process.env.OPERATOROS_E2E_ADMIN_PASSWORD!;

async function pdf(content: string): Promise<Buffer> {
  const document = await PDFDocument.create();
  document.addPage().drawText(content);
  return Buffer.from(await document.save());
}

test("@student-admin @critical verifies identity, DAPODIK, IOM archive, dashboard, and resolved queue tasks", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("textbox", { name: "Username required", exact: true }).fill(username);
  await page.getByRole("textbox", { name: "Password required", exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "System Analytics" })).toBeVisible();

  const name = `E2E Admin Student ${Date.now()}`;
  const created = await page.request.post("/api/student-masters", {
    headers: { origin: new URL(page.url()).origin },
    data: {
      identity: { full_name: name, nik: `SYNTHETIC-NIK-${Date.now()}`, kk: `SYNTHETIC-KK-${Date.now()}` },
      document_status: { family_card_received: true },
    },
  });
  expect(created.status()).toBe(201);
  const student = await (await page.request.get(`/api/student-masters?search=${encodeURIComponent(name)}`)).json();
  const studentId = String(student.items[0].id);

  await page.goto("/operator/work-queue");
  await expect(page.getByRole("heading", { name: "Antrean Kerja Operator" })).toBeVisible();
  await page.locator("select").first().selectOption("STUDENT_VERIFICATION");
  const search = page.getByPlaceholder("Cari berdasarkan nama siswa/staf, judul, atau ringkasan...");
  await search.fill(name);
  const task = page.locator("div.rounded-xl.border").filter({ hasText: name }).first();
  await expect(task.getByRole("link", { name: "Buka" })).toBeVisible();
  await task.getByRole("link", { name: "Buka" }).click();
  await expect(page).toHaveURL(new RegExp(`/students/${studentId}$`));

  await page.getByRole("tab", { name: "Personal Data" }).click();
  await expect(page.getByText("Document Received", { exact: true })).toBeVisible();
  await expect(page.getByText("Not Entered", { exact: true })).toHaveCount(0);

  for (const type of ["NIK", "KK"] as const) {
    const button = page.getByRole("button", { name: `Update ${type}` });
    await button.click();
    await page.locator(`#verify-${type}-status`).selectOption("IDENTIFIER_ENTERED");
    await page.getByRole("button", { name: "Save Verification" }).click();
    await expect(page.getByRole("tabpanel").getByText("IDENTIFIER ENTERED", { exact: true }).first()).toBeVisible();

    await button.click();
    await page.locator(`#verify-${type}-status`).selectOption("VERIFIED");
    await page.getByRole("button", { name: "Save Verification" }).click();
    await expect(page.getByRole("tabpanel").getByText("VERIFIED", { exact: true }).first()).toBeVisible();
  }

  await page.getByRole("button", { name: "Update DAPODIK" }).click();
  await page.locator("#dapodik-status-select").selectOption("PENDING_EXTERNAL_PROCESSING");
  await page.getByRole("button", { name: "Save Status" }).click();
  await page.getByRole("button", { name: "Update DAPODIK" }).click();
  await page.locator("#dapodik-status-select").selectOption("ENTERED");
  await page.getByRole("button", { name: "Save Status" }).click();
  await page.getByRole("button", { name: "Update DAPODIK" }).click();
  await expect(page.getByText("OperatorOS does not synchronize with DAPODIK.")).toBeVisible();
  await page.locator("#dapodik-status-select").selectOption("SYNCHRONIZED");
  await page.getByRole("button", { name: "Save Status" }).click();
  await expect(page.getByRole("tabpanel").getByText("Synchronized (confirmed externally)", { exact: true })).toBeVisible();

  await page.goto("/operator/work-queue");
  await page.locator("select").first().selectOption("STUDENT_VERIFICATION");
  await page.getByPlaceholder("Cari berdasarkan nama siswa/staf, judul, atau ringkasan...").fill(name);
  await page.getByRole("button", { name: "Segarkan" }).click();
  await expect(page.getByText("Semua Pekerjaan Selesai")).toBeVisible();

  await page.goto(`/students/${studentId}`);
  await page.getByRole("tab", { name: "IOM Documents" }).click();
  await expect(page.getByRole("heading", { name: "Inter Office Memo (IOM) Archive" })).toBeVisible();

  const incomingBytes = await pdf("Synthetic transfer-in memo");
  const incomingHash = createHash("sha256").update(incomingBytes).digest("hex");
  await page.getByRole("button", { name: "Upload IOM Memo" }).click();
  await page.locator("#iom-description").fill("Synthetic CSO transfer-in memo");
  await page.locator("#iom-file").setInputFiles({ name: "synthetic-transfer-in.pdf", mimeType: "application/pdf", buffer: incomingBytes });
  await page.getByRole("button", { name: "Upload Memo PDF" }).click();
  const incoming = page.locator("div.flex.flex-wrap.items-center.justify-between.gap-4.rounded-xl.border").filter({ hasText: "synthetic-transfer-in.pdf" });
  await expect(incoming).toContainText("Synthetic CSO transfer-in memo");
  const [incomingDownload] = await Promise.all([
    page.waitForEvent("download"),
    incoming.getByRole("button", { name: "Download PDF" }).click(),
  ]);
  expect(createHash("sha256").update(readFileSync(await incomingDownload.path()!)).digest("hex")).toBe(incomingHash);

  await incoming.getByRole("button", { name: "Edit Description" }).click();
  await page.locator("#iom-edit-desc").fill("Synthetic CSO transfer-in memo, description corrected");
  await page.getByRole("button", { name: "Save Description" }).click();
  await expect(incoming).toContainText("description corrected");
  const [editedDownload] = await Promise.all([
    page.waitForEvent("download"),
    incoming.getByRole("button", { name: "Download PDF" }).click(),
  ]);
  expect(createHash("sha256").update(readFileSync(await editedDownload.path()!)).digest("hex")).toBe(incomingHash);

  await page.getByRole("button", { name: "Upload IOM Memo" }).click();
  await page.locator("#iom-type-select").selectOption("TRANSFER_OUT");
  await page.locator("#iom-description").fill("Synthetic CSO transfer-out memo");
  await page.locator("#iom-file").setInputFiles({ name: "synthetic-transfer-out.pdf", mimeType: "application/pdf", buffer: await pdf("Synthetic transfer-out memo") });
  await page.getByRole("button", { name: "Upload Memo PDF" }).click();
  await expect(page.getByText("Transfer In", { exact: true })).toBeVisible();
  await expect(page.getByText("Transfer Out", { exact: true })).toBeVisible();
  await expect(page.getByText("Uploaded by operatoros_e2e_admin")).toHaveCount(2);

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Ringkasan Operasional Sekolah & DAPODIK" })).toBeVisible();
});

test("@dashboard @critical shows and acknowledges the annual BOSP reminder", async ({ page }) => {
  let acknowledged = false;
  const reminder = () => ({
    calendar_year: 2027,
    cutoff_date: "2027-08-31T23:59:59+07:00",
    advance_notice_days: 365,
    is_in_notice_window: true,
    days_remaining: 308,
    is_acknowledged: acknowledged,
    acknowledged_at: acknowledged ? "2026-10-27T00:00:00.000Z" : null,
    acknowledged_by: acknowledged ? "operatoros_e2e_admin" : null,
    notes: acknowledged ? "Acknowledged from the dashboard." : null,
    is_blocking: false,
  });

  await page.route("**/api/operator/bosp-reminder", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(reminder()) })
  );
  await page.route("**/api/operator/bosp-reminder/acknowledge", async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toMatchObject({ calendar_year: 2027 });
    acknowledged = true;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(reminder()) });
  });

  await page.goto("/login");
  await page.getByRole("textbox", { name: "Username required", exact: true }).fill(username);
  await page.getByRole("textbox", { name: "Password required", exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();

  const reminderHeading = page.getByRole("heading", { name: "Pengingat Tahunan Cut-off BOSP 2027" });
  await expect(reminderHeading).toBeVisible();
  await page.getByRole("button", { name: "Tandai Sudah Dipahami" }).click();
  await expect(page.getByText("Sudah Dipahami", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Tandai Sudah Dipahami" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Ringkasan Operasional Sekolah & DAPODIK" })).toBeVisible();
});

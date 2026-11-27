import { expect, test } from "../../../apps/web/node_modules/@playwright/test";
import { loginForFeature } from "../../helpers/feature-login";

test("@inventory-master-data @release manages category and funding options without discarding an asset draft", async ({ page }) => {
  await loginForFeature(page, { home: true });
  await page.goto("/inventory");
  await expect(page.getByRole("heading", { name: "Inventaris & Label Aset" })).toBeVisible();

  await page.getByRole("button", { name: "Tambah Aset" }).click();
  await page.getByLabel("Nama Barang *").fill("Aset uji master data");
  await page.getByRole("dialog", { name: "Tambah Aset Baru" }).getByRole("button", { name: "Kelola" }).first().click();

  const manager = page.getByRole("dialog", { name: "Kelola Data Inventaris" });
  await expect(manager.getByRole("heading", { name: "Kategori Aset" })).toBeVisible();
  await expect(manager.getByRole("heading", { name: "Sumber Dana" })).toBeVisible();

  const categories = manager.getByRole("region", { name: "Kategori Aset" });
  await categories.getByLabel("Kode kategori baru").fill("ZQX");
  await categories.getByLabel("Nama kategori baru").fill("Kategori Uji Browser");
  await categories.getByRole("button", { name: "Tambah" }).click();
  await expect(categories.getByLabel("Nama kategori ZQX")).toHaveValue("Kategori Uji Browser");

  const funding = manager.getByRole("region", { name: "Sumber Dana" });
  await funding.getByLabel("Nama sumber dana baru").fill("Sumber Uji Browser");
  const fundingCreated = page.waitForResponse((response) =>
    response.url().endsWith("/api/inventory/master-data/funding-sources") &&
    response.request().method() === "POST" &&
    response.status() === 201,
  );
  await funding.getByRole("button", { name: "Tambah" }).click();
  const fundingEntry = await (await fundingCreated).json() as { code: string };
  await expect(funding.getByLabel(`Nama sumber dana ${fundingEntry.code}`)).toHaveValue("Sumber Uji Browser");

  await manager.getByRole("button", { name: "Close dialog" }).click();
  const registration = page.getByRole("dialog", { name: "Tambah Aset Baru" });
  await expect(registration.getByLabel("Nama Barang *")).toHaveValue("Aset uji master data");
  await expect(page.locator("#reg-cat option").filter({ hasText: "Kategori Uji Browser" })).toHaveCount(1);
  await expect(page.locator("#reg-fund option").filter({ hasText: "Sumber Uji Browser" })).toHaveCount(1);
});

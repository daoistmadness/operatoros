import { expect, test, type Page } from "../../../frontend/node_modules/@playwright/test";

const username = process.env.OPERATOROS_E2E_ADMIN_USERNAME!;
const password = process.env.OPERATOROS_E2E_ADMIN_PASSWORD!;

async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("textbox", { name: "Username required", exact: true }).fill(username);
  await page.getByRole("textbox", { name: "Password required", exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "System Analytics" })).toBeVisible();
}

async function openConflict(page: Page, device: string) {
  const card = page.locator("article").filter({ hasText: device });
  await card.getByRole("button", { name: "Resolve" }).click();
  await expect(page.getByLabel("NIPD, NISN, student ID, device ID, or name")).toBeVisible();
}

test("resets sequential conflict state and supports explicit retry commit and roster review", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto("/upload");
  await page.getByRole("tab", { name: /Needs Attention/ }).click();

  await openConflict(page, "991001");
  const search = page.getByLabel("NIPD, NISN, student ID, device ID, or name");
  await search.fill("RESOLVE-001");
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("radio", { name: /E2E Conflict Alpha/ }).click();
  await page.getByRole("button", { name: "Confirm device link" }).click();
  await expect(page.getByText("Device identity linked")).toBeVisible();
  await page.getByRole("button", { name: "Retry preview" }).click();
  await expect(page.getByText("Retry preview complete")).toBeVisible();
  await page.getByRole("button", { name: "Clear" }).click();
  await expect(page.getByRole("button", { name: "Review commit" })).toBeDisabled();
  await page.getByRole("button", { name: "Select all eligible" }).click();
  await page.getByRole("button", { name: "Review commit" }).click();
  await expect(page.getByText(/Commit 1 selected row/)).toBeVisible();
  await page.getByRole("button", { name: "Confirm commit (1)" }).click();
  await expect(page.getByText("Selected attendance committed")).toBeVisible();
  await page.getByRole("button", { name: "Return to queue" }).click();

  await openConflict(page, "991002");
  await expect(search).toHaveValue("");
  await expect(page.getByText("E2E Conflict Alpha")).toHaveCount(0);
  await expect(page.getByText("Device identity linked")).toHaveCount(0);
  await expect(page.getByText("Retry preview complete")).toHaveCount(0);
  await page.getByRole("button", { name: "Return to queue" }).click();

  const roster = page.locator("article").filter({ hasText: "POSSIBLE_DUPLICATE" });
  await roster.getByRole("button", { name: "Compare records" }).click();
  await search.fill("RESOLVE-001");
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("radio", { name: /E2E Conflict Alpha/ }).click();
  await expect(page.getByText("Incoming roster")).toBeVisible();
  await expect(page.getByText("Existing master")).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm roster link" })).toBeEnabled();

  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
});

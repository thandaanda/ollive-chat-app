import { expect, test } from "@playwright/test";

test("renders the console shell", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByPlaceholder("Ask anything...")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Live Metrics" })).toBeVisible();
  await expect(page.getByTitle("New conversation")).toBeVisible();
  await expect(page.getByTitle("Provider settings")).toBeVisible();
});

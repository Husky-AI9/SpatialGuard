import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function expectWcagAA(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(result.violations, result.violations.map(item => `${item.id}: ${item.help}`).join("\n")).toEqual([]);
}

test("public entry, authentication, and legal pages have no automated WCAG AA violations", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const route of ["/landing", "/signin", "/signup", "/privacy", "/terms", "/data-deletion"]) {
    await page.goto(route);
    await expect(page.locator("body")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await expectWcagAA(page);
  }
});

test("the primary desktop and phone workspaces have no automated WCAG AA violations", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/workspace");
    const sample = page.getByRole("button", { name: "Load sample", exact: true });
    const map = page.getByRole("region", { name: "Home map" });
    await expect(sample.or(map)).toBeVisible({ timeout: 30_000 });
    if (await sample.count()) await sample.click();
    await expect(map).toBeVisible({ timeout: 30_000 });
    await expectWcagAA(page);
  }
});

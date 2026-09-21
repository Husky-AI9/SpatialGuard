import { test, expect } from "@playwright/test";
import path from "node:path";

const output = path.resolve("../../../.data/spatialguard");

test("desktop landing restores the spatial 3D-house experience", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/landing");

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("See what happened.Know where.");
  await expect(page.getByRole("img", { name: "Illustrative cutaway 3D home" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Try SpatialGuard" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Follow activity/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "See the delivery. Follow the whole moment." })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight)).toBeTruthy();

  await page.getByRole("button", { name: /Local replay preview/ }).click();
  await expect(page).toHaveURL(/\/signin$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.getByRole("link", { name: "Back to SpatialGuard" }).click();
  await page.getByRole("button", { name: "Create account" }).first().click();
  await expect(page).toHaveURL(/\/signup$/);
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
  await page.screenshot({ path: path.join(output, "landing-desktop.png"), fullPage: true });
});

test("landing fits a phone and preserves glass contrast", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/landing");

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBeTruthy();
  await expect(page.getByRole("link", { name: "Try it out" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign up" })).toBeVisible();
  await expect(page.getByRole("img", { name: /Detailed protected home/ })).toBeVisible();
  expect(await page.locator(".sg-mobile-scene").evaluate((element) => getComputedStyle(element).backdropFilter)).not.toBe("none");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/signin$/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await expect(page.getByLabel("Email")).toBeVisible();
  await page.screenshot({ path: path.join(output, "landing-phone-one-screen.png") });
});

test("try it out opens the local workspace", async ({ page }) => {
  await page.goto("/landing");
  await page.getByRole("link", { name: "Try SpatialGuard" }).click();
  await expect(page).toHaveURL(/\/workspace$/);
  await expect(page.locator(".lp-desktop")).toHaveCount(0);
});

test("privacy, terms, and deletion guidance are public and readable", async ({ page }) => {
  for (const [route, heading] of [
    ["/privacy", "Privacy notice"],
    ["/terms", "Preview terms"],
    ["/data-deletion", "Delete your data"],
  ] as const) {
    await page.goto(route);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expect(page.getByRole("link", { name: "Back" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  }
});

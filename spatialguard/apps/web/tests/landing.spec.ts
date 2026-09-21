import { test, expect } from "@playwright/test";
import path from "node:path";

const output = path.resolve("../../../.data/spatialguard");

test("landing is a complete one-screen product entry", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/landing");

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("See what happened.Know where.");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create account" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Try it out" })).toBeVisible();
  await expect(page.getByRole("img", { name: /Floor plan with two cameras/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBeTruthy();

  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("dialog")).toContainText("Hosted accounts are not enabled");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.getByRole("button", { name: "Create account" }).first().click();
  await expect(page.getByRole("heading", { name: "Create your SpatialGuard account" })).toBeVisible();
  await page.screenshot({ path: path.join(output, "landing-one-screen.png") });
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
  await page.screenshot({ path: path.join(output, "landing-phone-one-screen.png") });
});

test("try it out opens the local workspace", async ({ page }) => {
  await page.goto("/landing");
  await page.getByRole("link", { name: "Try it out" }).click();
  await expect(page).toHaveURL("http://127.0.0.1:8010/");
  await expect(page.locator(".sg-entry")).toHaveCount(0);
});

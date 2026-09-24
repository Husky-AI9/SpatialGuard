import { test, expect } from "@playwright/test";
import path from "node:path";

const output = path.resolve("../../../.data/spatialguard");

test("desktop landing matches the concept and its replay controls work", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/landing");

  await expect(page.getByRole("heading", { level: 1 }).first()).toHaveText("See what happened. Know where.");
  await expect(page.getByRole("img", { name: /Bird's-eye map/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Try SpatialGuard" }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Follow one delivery, start to finish" })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  expect(await page.locator(".sg-concept").evaluate(element => getComputedStyle(element).fontFamily)).toContain("Source Sans 3");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  expect(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight)).toBeTruthy();

  await page.getByRole("button", { name: /Leaves the package/ }).click();
  await expect(page.getByRole("button", { name: /Leaves the package/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".concept-replay-map polyline")).toHaveAttribute("points", /300,396$/);
  await expect(page.locator(".concept-replay-map")).toContainText("2:02:31 PM");
  await page.getByRole("button", { name: /Heads back to the van/ }).click();
  await expect(page.locator(".concept-replay-map polyline")).toHaveAttribute("points", /470,590$/);
  await page.getByRole("button", { name: "Pause animation" }).click();
  expect(await page.locator(".concept-hero-map > svg").evaluate(svg => (svg as SVGSVGElement).animationsPaused())).toBeTruthy();
  await page.getByRole("button", { name: "Switch to 3D map" }).click();
  await expect(page.getByRole("button", { name: "Switch to 3D map" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Switch to 2D map" }).click();
  await page.screenshot({ path: path.join(output, "landing-desktop.png"), fullPage: true });

  await page.getByRole("link", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/signin$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.getByRole("link", { name: "Back to SpatialGuard" }).click();
  await page.getByRole("link", { name: "FAQ", exact: true }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/signup$/);
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("concept reflows on smaller desktops and respects reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const width of [1280, 1024, 768, 600]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/landing");
    await expect(page.getByRole("img", { name: /Bird's-eye map/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await expect(page.getByRole("button", { name: "Play animation" })).toBeVisible();
  }
  await page.getByRole("link", { name: "FAQ", exact: true }).first().click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
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
  await expect(page.getByText("Open your SpatialGuard workspace", { exact: false })).toHaveCount(0);
  await expect(page.getByText("Passwords are stored as salted verifiers", { exact: false })).toHaveCount(0);
  await expect(page.getByAltText(/3D home protected/)).toBeHidden();
  await page.screenshot({ path: path.join(output, "landing-phone-one-screen.png") });
});

test("try it out opens the local workspace", async ({ page }) => {
  await page.goto("/landing");
  await page.getByRole("link", { name: "Try SpatialGuard" }).first().click();
  await expect(page).toHaveURL(/\/workspace$/);
  await expect(page.locator(".lp-desktop")).toHaveCount(0);
});

test("privacy, terms, and deletion guidance are public and readable", async ({ page }) => {
  for (const [route, heading] of [
    ["/privacy", "Privacy notice"],
    ["/terms", "Terms of service"],
    ["/data-deletion", "Delete your data"],
  ] as const) {
    await page.goto(route);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expect(page.getByRole("link", { name: "Back" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  }
});

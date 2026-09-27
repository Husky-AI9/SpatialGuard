import { test, expect } from "@playwright/test";

async function allowRingData(page: import("@playwright/test").Page) {
  await page.route("**/v1/account/preferences", route => route.fulfill({ json: {
    onboarding_completed: true,
    ring_data_consent: true,
    classification_consent: false,
    incident_retention_days: 90,
    audit_retention_days: 365,
    consent_updated_at: new Date().toISOString(),
  } }));
}

test("camera wall is available from Home and Cameras while Operations stays task-focused", async ({ page }) => {
  const operations = {
    devices: [{
      id: "ring-front", name: "Front Door", checked_at: new Date().toISOString(), online: true,
      uptime_percent: 99.8, history: [{ at: new Date().toISOString(), online: true, source: "inventory" }],
      site_id: "site-demo", camera_id: "camera-front", status: { online: true }, capabilities: {},
    }],
    alerts: [], preferences: { delay_seconds: 300, browser_enabled: 0, email_enabled: 0, email: "" },
    wall: [], projects: [], motion_events: [],
  };
  await page.route("**/v1/ring/operations", route => route.fulfill({ json: operations }));
  await page.goto("/");
  await page.getByRole("button", { name: "Operations", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Camera health" })).toBeVisible();
  await expect(page.getByText("99.8%")).toBeVisible();
  await expect(page.getByText("Front Door")).toBeVisible();
  await page.getByRole("tab", { name: "Time-lapse" }).click();
  await expect(page.getByRole("heading", { name: "Time-lapse projects" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Create a project" })).toBeVisible();
  await expect(page.getByText("Scheduled snapshots turned into a short reel.")).toBeVisible();

  await page.getByRole("button", { name: "Home", exact: true }).click();
  await page.getByRole("button", { name: "Camera wall", exact: true }).click();
  await expect(page.locator(".map-panel .camera-wall-view.compact")).toBeVisible();
  await expect(page.locator(".map-panel").getByText("Your camera wall is empty")).toBeVisible();

  await page.getByRole("button", { name: "Cameras", exact: true }).click();
  await page.getByRole("button", { name: "Camera wall", exact: true }).click();
  await expect(page.locator(".camera-page > .camera-wall-view")).toBeVisible();
  await expect(page.getByText("Open an incident to watch its recordings", { exact: false })).toBeVisible();
});

test("Ring setup keeps customer flow clear and provides single-use fallback", async ({
  page,
}) => {
  await allowRingData(page);
  // Keep this UI test independent of whichever real Ring account is linked on
  // the developer's machine.
  await page.route("**/v1/ring", (r) =>
    r.fulfill({
      json: {
        configured: true,
        state: "not_connected",
        public_url: "https://gateway.example.test",
      },
    }),
  );
  await page.route("**/v1/ring/devices", (r) => r.fulfill({ json: [] }));
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Ring cameras" }).click();
  await expect(
    page.getByRole("heading", { name: "Ring connection", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Link your Ring account to add cameras.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Ring Appstore" })).toBeVisible();
  await expect(page.getByText("Developer connection settings")).toHaveCount(0);
  await expect(page.getByText("Staging Apps", { exact: false })).toHaveCount(0);
  await page.screenshot({
    path: "../../../.data/spatialguard/ring-settings-desktop.png",
    fullPage: true,
  });
  // Generate only a fake code in this UI test; never invalidate an owner's live code.
  await page.route("**/v1/ring/sign-in-code", (r) =>
    r.fulfill({
      json: { code: "AABBCCDDEEFF0011", expires_at: Date.now() / 1000 + 600 },
    }),
  );
  await page.getByRole("button", { name: "Create Ring sign-in code" }).click();
  await expect(
    page.getByText("AABBCCDDEEFF0011", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("Single use · expires", { exact: false }),
  ).toBeVisible();
});

test("returning from Ring opens Settings and refreshes the authorized inventory", async ({ page }) => {
  await allowRingData(page);
  let refreshes = 0;
  await page.route("**/v1/ring", route => route.fulfill({ json: {
    configured: true,
    state: "connected",
    public_url: "https://gateway.example.test",
  } }));
  await page.route("**/v1/ring/devices/refresh", route => {
    refreshes += 1;
    return route.fulfill({ json: [] });
  });

  await page.goto("/?ring=connected");

  await expect(page.getByRole("heading", { name: "Ring connection", exact: true })).toBeVisible();
  await expect.poll(() => refreshes).toBe(1);
  await expect.poll(() => new URL(page.url()).searchParams.has("ring")).toBe(false);
});

test("phone Ring inventory handles mapping and provider errors without fake live video", async ({
  page,
}) => {
  await allowRingData(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const device = {
    id: "device-a",
    name: "Front camera",
    status: { online: true },
    capabilities: {},
    checked_at: new Date().toISOString(),
    site_id: null,
    camera_id: null,
    support: { live_view: true, snapshots: true, motion_events: true, multi_camera: false },
    configuration: { motion_detection: "on", guidance: [] },
    guidance: ["Smart Alerts are unavailable. Review this camera in the Ring app."],
  };
  await page.route("**/v1/ring", (r) =>
    r.fulfill({
      json: {
        configured: true,
        state: "connected",
        public_url: "https://gateway.example.test",
        subscription: {
          required: false, eligible: true, state: "active_paid",
          expires_at: "2027-01-01T00:00:00Z", manage_url: "https://ring.com/my-apps",
        },
        subscription_checked_at: new Date().toISOString(),
      },
    }),
  );
  await page.route("**/v1/ring/devices", (r) => r.fulfill({ json: [device] }));
  await page.route("**/v1/ring/devices/refresh", (r) =>
    r.fulfill({
      status: 503,
      json: { detail: "Ring is unreachable. Check your internet connection." },
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Ring cameras" }).click();
  await expect(
    page.getByText("Account connected · Live integration"),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Front camera" }),
  ).toBeVisible();
  await expect(page.getByText("Ring plan active")).toBeVisible();
  await expect(page.getByText("Live view and motion events", { exact: false })).toBeVisible();
  await expect(page.getByText("Smart Alerts are unavailable", { exact: false })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open live view" }),
  ).toBeDisabled();
  await expect(
    page.getByLabel("Floor-plan camera for Front camera"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Refresh Ring cameras" }).click();
  await expect(page.getByRole("alert")).toContainText("Ring is unreachable");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "../../../.data/spatialguard/ring-settings-phone.png",
    fullPage: true,
  });
});

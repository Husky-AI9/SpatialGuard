// Device integration test: run after installing the debug APK on the local emulator.
import { chromium, request, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
const packageId = "app.spatialguard.mobile";
const component = `${packageId}/dev.spatialguard.preview.MainActivity`;
const device = execFileSync("adb", ["devices"], { encoding: "utf8", windowsHide: true })
  .split(/\r?\n/).slice(1).map(line => line.trim().split(/\s+/)).find(parts => parts[1] === "device")?.[0];
if (!device) throw new Error("No authorized Android emulator or device is attached");
const adb = (...args) =>
  execFileSync("adb", ["-s", device, ...args], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 20000,
  }).trim();
const output = path.resolve("../../../.data/spatialguard");
mkdirSync(output, { recursive: true });
const results = [];
const record = (value) => { results.push(value); console.log(value); };
let browser;
const web = await request.newContext({
  baseURL: "http://127.0.0.1:8010",
  extraHTTPHeaders: {
    "X-SpatialGuard-Local": "1",
    Origin: "http://127.0.0.1:8010",
  },
});
await web.post("/v1/local-session");
adb("reverse", "tcp:8010", "tcp:8010");
adb("shell", "pm", "clear", packageId);
adb(
  "shell",
  "am",
  "start",
  "-W",
  "-n",
  component,
);
const pid = adb("shell", "pidof", packageId);
adb("forward", "tcp:9223", `localabstract:webview_devtools_remote_${pid}`);
try {
  await expect
    .poll(
      async () => {
        try {
          return (await fetch("http://127.0.0.1:9223/json")).status;
        } catch {
          return 0;
        }
      },
      { timeout: 30000 },
    )
    .toBe(200);
  browser = await chromium.connectOverCDP("http://127.0.0.1:9223", {
    noDefaults: true,
  });
  const context = browser.contexts()[0];
  const page = context.pages()[0];
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(15000);
  await expect(page.getByRole("heading", { name: /See what happened/ })).toBeVisible({ timeout: 30000 });
  record("Mobile landing is the first screen");
  await page.getByRole("button", { name: /Sign up/ }).first().click();
  const email = `android-${Date.now()}@example.test`;
  const password = "SpatialGuard-test-12345";
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: /Create account/ }).click();
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  record("Native signup and authenticated API passed");
  const encrypted = adb(
    "shell",
    "run-as",
    packageId,
    "cat",
    "shared_prefs/secure_session.xml",
  );
  if (!encrypted.includes("ciphertext") || encrypted.includes('name="token"'))
    throw new Error("Credential storage check failed");
  record("Credential is stored as Keystore-encrypted ciphertext");
  // New accounts correctly start empty. Pair to the seeded local owner only for
  // the remainder of this synthetic replay/device regression.
  const pairing = await (await web.post("/v1/pairing")).json();
  const paired = await (await web.post("/v1/pairing/redeem", {
    data: { code: pairing.code, name: "Android emulator regression" },
    headers: { "X-SpatialGuard-Client": "android" },
  })).json();
  await page.evaluate(async (token) => {
    await globalThis.Capacitor.Plugins.SecureSession.write({ token });
    window.location.assign("/?workspace=1");
  }, paired.token);
  await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible({ timeout: 30000 });
  record("Single-use Android pairing opened the seeded replay workspace");
  await page
    .getByRole("button", { name: "Run replay", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Activity observed near the entry" }),
  ).toBeVisible({ timeout: 60000 });
  await expect(
    page.getByRole("img", {
      name: "Synthetic replay illustration of a person, not camera footage",
    }),
  ).toBeVisible({ timeout: 20000 });
  await page
    .getByRole("button", { name: "Mark reviewed", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Reviewed", exact: true }),
  ).toBeDisabled();
  const sites = await (await web.get("/v1/sites")).json();
  const items = await (
    await web.get(`/v1/sites/${sites[0].id}/incidents`)
  ).json();
  if (items.incidents[0].status !== "reviewed")
    throw new Error("Cross-client review mismatch");
  record("Native replay, evidence and shared web review passed");
  writeFileSync(
    path.join(output, "android-detail.png"),
    execFileSync(
      "adb",
      ["-s", device, "exec-out", "screencap", "-p"],
      { windowsHide: true },
    ),
  );
  await page.getByRole("button", { name: "3D", exact: true }).click();
  await expect(page.locator(".spatial-scene canvas")).toBeVisible({
    timeout: 30000,
  });
  writeFileSync(
    path.join(output, "android-3d.png"),
    execFileSync(
      "adb",
      ["-s", device, "exec-out", "screencap", "-p"],
      { windowsHide: true },
    ),
  );
  record("Android WebView 3D canvas rendered");
  adb("shell", "input", "keyevent", "4");
  await expect(
    page.getByRole("heading", { name: "Activity observed near the entry" }),
  ).not.toBeVisible();
  await page.getByRole("button", { name: "Cameras", exact: true }).click();
  adb("shell", "input", "keyevent", "4");
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
  record("Android hardware back closes detail then returns Home");
  adb("shell", "settings", "put", "system", "accelerometer_rotation", "0");
  adb("shell", "settings", "put", "system", "user_rotation", "1");
  await expect
    .poll(() => page.evaluate(() => innerWidth > innerHeight), {
      timeout: 15000,
    })
    .toBe(true);
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
  record("Landscape rotation keeps workspace");
  adb("shell", "settings", "put", "system", "user_rotation", "0");
  adb("shell", "input", "keyevent", "3");
  adb(
    "shell",
    "am",
    "start",
    "-W",
    "-n",
    component,
  );
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
  record("Background/resume reconnects");
  execFileSync('powershell.exe',['-NoProfile','-File',path.resolve('../../scripts/stop.ps1')],{windowsHide:true});
  await expect(
    page.getByRole("status").filter({ hasText: "Disconnected" }),
  ).toBeVisible({ timeout: 45000 });
  execFileSync('powershell.exe',['-NoProfile','-File',path.resolve('../../scripts/start.ps1')],{windowsHide:true});
  await page.getByRole("button", { name: "Refresh workspace" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Disconnected" }),
  ).toHaveCount(0, { timeout: 30000 });
  record("Native offline/reconnect and backend restart passed");
  await page.reload({waitUntil:'commit'});
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible({ timeout: 20000 });
  record("Reload restores encrypted native session");
  writeFileSync(
    path.join(output, "android-home.png"),
    execFileSync(
      "adb",
      ["-s", device, "exec-out", "screencap", "-p"],
      { windowsHide: true },
    ),
  );
  writeFileSync(
    path.join(output, "android-verification.json"),
    JSON.stringify(
      {
        results,
        device: adb("shell", "getprop", "ro.product.model"),
        sdk: adb("shell", "getprop", "ro.build.version.sdk"),
      },
      null,
      2,
    ),
  );
  console.log(results.join("\n"));
} finally {
  execFileSync('powershell.exe',['-NoProfile','-File',path.resolve('../../scripts/start.ps1')],{windowsHide:true});
  adb("reverse", "tcp:8010", "tcp:8010");
  adb("shell", "settings", "put", "system", "user_rotation", "0");
  adb("shell", "settings", "put", "system", "accelerometer_rotation", "1");
  await browser?.close();
  await web.dispose();
}

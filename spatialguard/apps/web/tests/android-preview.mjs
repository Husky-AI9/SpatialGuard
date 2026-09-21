// Device integration test: run after installing the debug APK on the local emulator.
import { chromium, request, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
const adb = (...args) =>
  execFileSync("adb", ["-s", "emulator-5554", ...args], {
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
adb(
  "shell",
  "am",
  "start",
  "-W",
  "-n",
  "dev.spatialguard.preview/.MainActivity",
);
const pid = adb("shell", "pidof", "dev.spatialguard.preview");
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
  await expect(
    page
      .getByLabel("Pairing code", { exact: true })
      .or(page.getByRole("heading", { name: "Home", exact: true })),
  ).toBeVisible({ timeout: 30000 });
  if (await page.getByLabel("Pairing code", { exact: true }).count()) {
    const code = (await (await web.post("/v1/pairing")).json()).code;
    await page.getByLabel("Pairing code", { exact: true }).fill(code);
    await page.getByRole("button", { name: "Pair device" }).click();
  }
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  record("Native pairing and authenticated API passed");
  const encrypted = adb(
    "shell",
    "run-as",
    "dev.spatialguard.preview",
    "cat",
    "shared_prefs/secure_session.xml",
  );
  if (!encrypted.includes("ciphertext") || encrypted.includes('name="token"'))
    throw new Error("Credential storage check failed");
  record("Credential is stored as Keystore-encrypted ciphertext");
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
      ["-s", "emulator-5554", "exec-out", "screencap", "-p"],
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
      ["-s", "emulator-5554", "exec-out", "screencap", "-p"],
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
    "dev.spatialguard.preview/.MainActivity",
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
    page.getByRole("status").filter({ hasText: "Workspace connected" }),
  ).toBeVisible({ timeout: 30000 });
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
      ["-s", "emulator-5554", "exec-out", "screencap", "-p"],
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

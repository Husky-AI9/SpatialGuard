import { test, expect } from "@playwright/test";
import path from "node:path";
const output = path.resolve("../../../.data/spatialguard");

async function allowProviderFeatures(page: import("@playwright/test").Page) {
  await page.route("**/v1/account/preferences", async route => {
    const body = route.request().method() === "PATCH"
      ? route.request().postDataJSON()
      : {};
    await route.fulfill({ json: {
      onboarding_completed: true,
      ring_data_consent: true,
      classification_consent: true,
      incident_retention_days: 90,
      audit_retention_days: 365,
      consent_updated_at: new Date().toISOString(),
      ...body,
    } });
  });
}

/** A workspace can be empty, and the owner's last place is remembered, so put the
 *  demo home in front of tests that rely on its replay fixture. */
async function openDemo(page: import("@playwright/test").Page) {
  // Keep UI tests deterministic and avoid contacting a real camera. The
  // backend integration is exercised separately in the Ring service tests.
  await page.route("**/v1/ring/sites/*/cameras/*/snapshot", (route) =>
    route.fulfill({
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      ),
    }),
  );
  await page.route("**/v1/ring/devices/*/streams", (route) =>
    route.fulfill({ status: 503, json: { detail: "Synthetic live-view stop" } }),
  );
  await page.goto("/");
  const empty = page.getByRole("button", { name: "Load sample", exact: true });
  const map = page.locator(".spatial-map").first();
  // Wait for the workspace to finish opening before deciding what it shows;
  // checking too early sees neither and silently skips loading the sample.
  await expect(empty.or(map)).toBeVisible({ timeout: 30000 });
  if (await empty.count()) await empty.click();
  await expect(map).toBeVisible({ timeout: 30000 });
  const chooser = page.locator("select.site-name");
  if (await chooser.count()) {
    const current = await chooser.locator("option:checked").textContent();
    if (current !== "Demo home") await chooser.selectOption({ label: "Demo home" });
  }
  await expect(page.locator(".spatial-map")).toBeVisible({ timeout: 30000 });
}

test("replay to incident, evidence, review, map and monitoring", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openDemo(page);
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
  if (await page.getByRole("button", { name: "Enable", exact: true }).count())
    await page.getByRole("button", { name: "Enable", exact: true }).click();
  await page
    .getByRole("button", { name: "Run replay", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Activity observed near the entry" }),
  ).toBeVisible({ timeout: 45000 });
  await expect(
    page.getByText("Possible continuation · 6s unobserved"),
  ).toBeVisible();
  await expect(
    page.getByRole("img", {
      name: "Synthetic replay illustration of a person, not camera footage",
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /Unknown · coverage gap/ })
    .first()
    .click();
  await expect(
    page.getByText(
      "Unknown location — no footage or coordinate evidence for this gap.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Mark reviewed" }).click();
  await expect(
    page.getByRole("button", { name: "Reviewed", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Living room", exact: true }).click();
  await page.screenshot({
    path: path.join(output, "web-desktop.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "3D", exact: true }).click();
  await expect(page.locator(".spatial-scene canvas")).toBeVisible();
  await page.screenshot({
    path: path.join(output, "web-3d.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Run replay", exact: true }).first(),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Enable", exact: true }).click();
  await page.reload();
  await page
    .getByRole("button", { name: /Activity observed near the entry/ })
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: "Reviewed", exact: true }),
  ).toBeDisabled();
  expect(errors).toEqual([]);
});

test("home keeps CCTV and incidents in one right rail beside a full green 2D map", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openDemo(page);

  const map = page.getByRole("region", { name: "Home map" });
  const rail = page.getByRole("complementary", { name: "Home activity" });
  await expect(rail.getByRole("heading", { name: "CCTVs" })).toBeVisible();
  await expect(rail.getByRole("heading", { name: "Recent incidents" })).toBeVisible();
  const [mapBox, railBox] = await Promise.all([map.boundingBox(), rail.boundingBox()]);
  expect(railBox!.x).toBeGreaterThan(mapBox!.x + mapBox!.width);
  await expect(page.locator(".map-area-2d")).toHaveCSS("background-color", "rgb(207, 224, 194)");
  expect(
    await page.locator(".spatial-map").evaluate((svg) => {
      const view = (svg as SVGSVGElement).viewBox.baseVal;
      const ground = svg.querySelector(".map-ground") as SVGRectElement;
      const close = (left: number, right: number) => Math.abs(left - right) < 0.001;
      return (
        close(Number(ground.getAttribute("x")), view.x) &&
        close(Number(ground.getAttribute("y")), view.y) &&
        close(Number(ground.getAttribute("width")), view.width) &&
        close(Number(ground.getAttribute("height")), view.height)
      );
    }),
  ).toBeTruthy();
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBeTruthy();

  const camera = rail.getByRole("button", { name: /Open .* feed and select it on map/ }).first();
  if (await camera.count()) {
    const hasLiveFeed = (await camera.getByText("Live available", { exact: true }).count()) > 0;
    const thumbnail = camera.locator(".home-camera-thumb");
    await expect(thumbnail).toBeVisible();
    await expect(thumbnail.locator("img, svg")).toHaveCount(1);
    await camera.click();
    await expect(page.locator(".camera-marker[aria-pressed=true]")).toHaveCount(1);
    const stageContent = hasLiveFeed
      ? rail.locator(".ring-video-actions")
      : rail.locator(".home-cctv-empty");
    await expect(stageContent).toBeVisible();
    if (hasLiveFeed) await expect(rail.locator(".home-cctv-stage video")).toBeVisible();
    await expect(map.locator(".map-camera-panel")).toHaveCount(0);
    const fits = async () => rail.evaluate((element, contentSelector) => {
      const cctv = element.querySelector<HTMLElement>(".home-cctv")!;
      const controls = element.querySelector<HTMLElement>(contentSelector)!;
      const incidents = element.querySelector<HTMLElement>(".incident-list")!;
      const incidentRow = element.querySelector<HTMLElement>(".incident-row");
      const cctvBox = cctv.getBoundingClientRect();
      const controlBox = controls.getBoundingClientRect();
      const incidentBox = incidents.getBoundingClientRect();
      return {
        horizontal: {
          cctv: [cctv.clientWidth, cctv.scrollWidth],
          incidents: [incidents.clientWidth, incidents.scrollWidth],
          incidentRow: incidentRow
            ? [incidentRow.clientWidth, incidentRow.scrollWidth]
            : [0, 0],
        },
        controlsInside: controlBox.right <= cctvBox.right + 1 && controlBox.bottom <= cctvBox.bottom + 1,
        sectionsSeparate: cctvBox.bottom <= incidentBox.top + 1,
      };
    }, hasLiveFeed ? ".ring-video-actions" : ".home-cctv-empty");
    const wideFit = await fits();
    expect(wideFit.horizontal.cctv[1]).toBeLessThanOrEqual(wideFit.horizontal.cctv[0]);
    expect(wideFit.horizontal.incidents[1]).toBeLessThanOrEqual(wideFit.horizontal.incidents[0]);
    expect(wideFit.horizontal.incidentRow[1]).toBeLessThanOrEqual(wideFit.horizontal.incidentRow[0]);
    expect(wideFit).toMatchObject({
      controlsInside: true,
      sectionsSeparate: true,
    });
    await page.setViewportSize({ width: 900, height: 900 });
    const narrowFit = await fits();
    expect(narrowFit.horizontal.cctv[1]).toBeLessThanOrEqual(narrowFit.horizontal.cctv[0]);
    expect(narrowFit.horizontal.incidents[1]).toBeLessThanOrEqual(narrowFit.horizontal.incidents[0]);
    expect(narrowFit.horizontal.incidentRow[1]).toBeLessThanOrEqual(narrowFit.horizontal.incidentRow[0]);
    expect(narrowFit).toMatchObject({
      controlsInside: true,
      sectionsSeparate: true,
    });
    await page.getByRole("button", { name: "3D", exact: true }).click();
    await expect(page.locator(".spatial-scene canvas")).toBeVisible();
    await expect(stageContent).toBeVisible();
  }
});

test("3D camera pins select CCTV by mouse and keyboard without resetting the view", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openDemo(page);
  await page.getByRole("button", { name: "3D", exact: true }).click();
  const map = page.getByRole("region", { name: "Home map", exact: true });
  const front = map.getByRole("button", { name: "Select Front camera on 3D map", exact: true });
  const hall = map.getByRole("button", { name: "Select Hallway camera on 3D map", exact: true });
  await expect(front).toBeVisible();
  await expect(hall).toBeVisible();
  const initial = await front.getAttribute("style");
  const canvas = await map.locator("canvas").boundingBox();
  await page.mouse.move(canvas!.x + canvas!.width / 2, canvas!.y + canvas!.height / 2);
  await page.mouse.wheel(0, 280);
  await expect.poll(() => front.getAttribute("style")).not.toBe(initial);
  const zoomed = await front.boundingBox();
  await front.click();
  await expect(front).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("complementary", { name: "Home activity" })
    .getByRole("heading", { name: "Front camera", exact: true })).toBeVisible();
  const selected = await front.boundingBox();
  expect(Math.abs(selected!.x - zoomed!.x)).toBeLessThan(5);
  expect(Math.abs(selected!.y - zoomed!.y)).toBeLessThan(5);
  await hall.focus();
  await page.keyboard.press("Enter");
  await expect(hall).toHaveAttribute("aria-pressed", "true");
  await expect(front).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("complementary", { name: "Home activity" })
    .getByRole("heading", { name: "Hallway camera", exact: true })).toBeVisible();
  await page.screenshot({ path: `${output}/3d-camera-pins.png`, fullPage: true });
  await page.getByRole("button", { name: "2D", exact: true }).click();
  await expect(map.locator(".scene-camera-pin")).toHaveCount(0);
  await page.getByRole("button", { name: "3D", exact: true }).click();
  await expect(map.locator(".scene-camera-pin")).toHaveCount(2);
});

test("live multi-camera evidence shows camera nodes and an unknown gap, not a person dot", async ({ page }) => {
  await openDemo(page);
  const sites = await page.evaluate(() => fetch("/v1/sites").then(response => response.json()));
  const demo = sites.find((site: { name: string }) => site.name === "Demo home");
  const [first, second] = demo.layout.cameras;
  const observedAt = "2026-09-21T12:00:00+00:00";
  const nextAt = "2026-09-21T12:01:20+00:00";
  const observation = (id: string, camera: string, at: string) => ({
    observation_id: id, site_id: demo.id, revision_id: demo.revision_id,
    source_id: camera, observed_at: at, received_at: at, category: "motion_detected",
    location: { kind: "unknown", reason: "Ring event metadata supplies no calibrated person location." },
    evidence: { mode: "live" },
    provenance: { kind: "measured", confirmed: false, explanation: "Signed Ring event; no person coordinate." },
  });
  const incident = {
    id: "incident-live-graph", site_id: demo.id, revision_id: demo.revision_id,
    run_id: "ring-live-graph", title: "Activity across 2 Ring cameras",
    rule: "Two Ring events were grouped within five minutes. Movement is unknown.",
    started_at: observedAt, created_at: observedAt, status: "needs_review", reviewed_at: null,
    evidence_mode: "live", calibration_ids: [], evidence_ids: [],
    classification_status: "not_requested", classification: null,
    observations: [observation("obs-front", first.id, observedAt), observation("obs-hall", second.id, nextAt)],
    associations: [{ state: "possible", from_observation_id: "obs-front", to_observation_id: "obs-hall",
      reason: "Possible continuation only; identity and movement are unknown.", unobserved_gap_seconds: 80 }],
  };
  await page.route(`**/v1/sites/${demo.id}/incidents*`, route => route.fulfill({ json: { incidents: [incident], next_cursor: null } }));
  await page.route("**/v1/incidents/incident-live-graph", route => route.fulfill({ json: incident }));
  await page.getByRole("button", { name: "Refresh workspace" }).click();
  await page.getByRole("button", { name: /Activity across 2 Ring cameras/ }).first().click();
  const legend = page.getByLabel("Spatial evidence graph legend");
  await expect(legend.getByText("Observed by camera")).toBeVisible();
  await expect(legend.getByText("Unknown gap")).toBeVisible();
  await expect(page.locator(".evidence-link")).toHaveCount(1);
  await expect(page.locator(".map-actor")).toHaveCount(0);
  const inspector = page.getByLabel("Selected evidence details");
  await expect(inspector.getByText("Live Ring event")).toBeVisible();
  await expect(inspector.getByText("Event metadata only", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: "The same event, two review methods" })).toBeVisible();
  await expect(page.getByText("Camera-by-camera", { exact: true })).toBeVisible();
  await page.getByText("Why is this only a possible continuation?").click();
  await expect(page.getByText("no camera observation establishes the route", { exact: false })).toBeVisible();
  await page.screenshot({ path: path.join(output, "spatial-evidence-graph.png"), fullPage: true });
  await page.getByRole("button", { name: "3D", exact: true }).click();
  await expect(page.locator('.spatial-scene[data-evidence-links="1"] canvas')).toBeVisible();
});

test("low-power mode keeps 2D evidence available and disables WebGL", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("spatialguard-low-power", "false"));
  await openDemo(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Turn on low-power mode" }).click();
  await expect(page.getByText("Low-power mode is on", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(page.getByRole("button", { name: "2D", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "3D", exact: true })).toBeDisabled();
  await expect(page.locator(".spatial-map")).toBeVisible();
});

test("private day and night clips animate an approximate 2D and 3D movement trail", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await allowProviderFeatures(page);
  const classificationRequests: string[] = [];
  await page.route("**/v1/test-videos/*/classify", (route) => {
    classificationRequests.push(route.request().url());
    const threat = route.request().url().includes("delivery-night");
    return route.fulfill({
      json: {
        label: threat ? "possible_weapon_visible" : "delivery_activity",
        display_label: threat ? "Possible weapon visible" : "Possible delivery",
        confidence: threat ? "low" : "high",
        summary: threat
          ? "A dark object may resemble a weapon, but the image is unclear."
          : "A person is holding a parcel at the entrance.",
        visible_evidence: threat ? ["Ambiguous dark object"] : ["Parcel"],
        uncertainty: "Identity and intent are unknown.",
        model: "gpt-5.6-luna",
        response_id: "browser_fixture",
        analyzed_at: new Date().toISOString(),
      },
    });
  });
  await page.route(/\/v1\/sites\/[^/?]+(?:\?.*)?$/, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    if (body.monitoring) body.monitoring.classification_enabled = true;
    return route.fulfill({ response, json: body });
  });
  await page.route("**/v1/sites", async route => {
    const response = await route.fetch();
    const body = await response.json();
    body.forEach((site: { monitoring?: { classification_enabled?: boolean } }) => {
      if (site.monitoring) site.monitoring.classification_enabled = true;
    });
    return route.fulfill({ response, json: body });
  });
  await openDemo(page);
  const camera = page
    .getByRole("complementary", { name: "Home activity" })
    .getByRole("button", { name: /Open .* feed and select it on map/ })
    .first();
  await camera.click();
  await page.getByRole("button", { name: "Test delivery videos" }).click();
  const day = page.getByLabel("Delivery test · daylight");
  await expect(day).toBeVisible();
  await expect(page.locator(".test-video-status small")).toContainText("Person track ready", { timeout: 15000 });
  await day.evaluate((element: HTMLVideoElement) => {
    element.playbackRate = 4;
    return element.play();
  });
  await expect.poll(() => page.locator(".approximate-marker").count()).toBeGreaterThan(0);
  await expect(page.locator(".motion-box")).toHaveCount(0);
  await page.waitForTimeout(3000);
  await day.evaluate((element: HTMLVideoElement) => { element.pause(); element.currentTime = 1; });
  await expect(page.locator(".approximate-marker")).toHaveCount(1);
  await page.screenshot({ path: `${output}/person-track-day.png`, fullPage: true });
  await page.getByRole("button", { name: "3D", exact: true }).click();
  await expect(
    page.getByRole("img", { name: "Illustrative 3D home map with approximate movement trail" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "2D", exact: true }).click();
  await page.getByRole("button", { name: "Night delivery" }).click();
  const night = page.getByLabel("Delivery test · night");
  await expect(page.locator(".test-video-status small")).toContainText("Person track ready", { timeout: 15000 });
  await night.evaluate((element: HTMLVideoElement) => element.play());
  await expect.poll(() => page.locator(".approximate-marker").count()).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Day delivery" }).click();
  await expect(page.getByText("Possible delivery", { exact: true })).toBeVisible();
  await expect(page.locator(".map-scale")).toContainText("2 m");
  await expect(page.locator(".test-video-status-routine")).toContainText("Routine activity");
  await page.getByLabel("Delivery test · daylight").evaluate((element: HTMLVideoElement) => element.play());
  await expect(page.locator(".map-actor-delivery")).toBeVisible();
  await expect(page.getByText("Delivery worker", { exact: true })).toBeVisible();
  await page.screenshot({ path: `${output}/person-icon-delivery.png`, fullPage: true });
  await day.evaluate((element: HTMLVideoElement) => { element.pause(); element.currentTime = 15; });
  await expect(page.locator(".map-actor")).toHaveCount(0);
  await expect(page.locator(".test-video-status strong")).toHaveText("No longer visible - position unknown");
  await page.getByRole("button", { name: "Night delivery" }).click();
  await expect(page.locator(".test-video-status small")).toContainText("Person track ready", { timeout: 15000 });
  await expect(page.locator(".test-video-status-urgent")).toContainText("Urgent review");
  await page.getByLabel("Delivery test · night").evaluate((element: HTMLVideoElement) => element.play());
  await expect(page.locator(".map-actor-weapon")).toBeVisible();
  await expect(page.getByText("Possible weapon", { exact: true })).toBeVisible();
  await page.screenshot({ path: `${output}/person-icon-threat.png`, fullPage: true });
  await page.getByRole("button", { name: "3D", exact: true }).click();
  await expect(page.locator(".spatial-scene")).toHaveAttribute(
    "data-actor-model",
    "possible-weapon-person",
  );
  await page.getByRole("button", { name: "2D", exact: true }).click();
  await night.evaluate((element: HTMLVideoElement) => { element.pause(); element.currentTime = 8; });
  await expect(page.locator(".map-actor")).toHaveCount(0);
  await expect(page.locator(".test-video-status strong")).toHaveText("No longer visible - position unknown");
  await page.getByRole("button", { name: "3D", exact: true }).click();
  await expect(page.locator(".spatial-scene")).toHaveAttribute("aria-description", "Estimated path retained. Person not currently visible.");
  await page.screenshot({ path: `${output}/person-left-camera-view.png`, fullPage: true });
  expect(classificationRequests).toHaveLength(2);
});
test("classification icons distinguish activities without turning person tracks into objects", async ({ page }) => {
  await allowProviderFeatures(page);
  let label = "face_covering_visible";
  await page.route("**/v1/test-videos/*/classify", route => route.fulfill({ json: {
    label, display_label: "Fixture activity", confidence: "low",
    summary: "UI fixture, not real detection evidence.", visible_evidence: [],
    uncertainty: "Requires review.", model: "fixture", analyzed_at: new Date().toISOString(),
  } }));
  await page.route("**/v1/sites/**", async route => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    if (body.monitoring) body.monitoring.classification_enabled = true;
    return route.fulfill({ response, json: body });
  });
  await page.route("**/v1/sites", async route => {
    const response = await route.fetch();
    const body = await response.json();
    body.forEach((site: { monitoring?: { classification_enabled?: boolean } }) => {
      if (site.monitoring) site.monitoring.classification_enabled = true;
    });
    return route.fulfill({ response, json: body });
  });
  await openDemo(page);
  await page.getByRole("complementary", { name: "Home activity" })
    .getByRole("button", { name: /Open .* feed and select it on map/ }).first().click();
  const cases = [
    ["face_covering_visible", "face_covering", "face_covering", "review"],
    ["possible_unauthorized_entry", "intrusion", "intrusion", "urgent"],
    ["unidentified_person", "person", "person", "review"],
    ["package_visible", "package", "person", "routine"],
    ["animal_visible", "animal", "person", "routine"],
    ["vehicle_visible", "vehicle", "person", "routine"],
    ["unclear", "unknown", "person", "review"],
    ["no_relevant_activity", "none", "person", "review"],
  ];
  for (const [resultLabel, icon, actor, review] of cases) {
    label = resultLabel;
    await page.getByRole("button", { name: "Test delivery videos" }).click();
    await expect(page.locator(`.test-video-status .activity-symbol-${icon}`)).toBeVisible();
    await expect(page.locator(`.test-video-status-${review}`)).toBeVisible();
    await page.locator(".test-video-stage video").evaluate(async (video: HTMLVideoElement) => {
      video.currentTime = 1; await video.play();
    });
    await expect(page.locator(`.map-actor-${actor}`)).toBeVisible();
    if (actor === "person" && icon !== "person")
      await expect(page.locator(".map-actor-person")).toHaveAttribute("aria-label", "Person · not classified");
    await page.getByRole("button", { name: "Live camera", exact: true }).click();
  }
});

test("person exit preserves the path through gaps, seeking, view changes and replay end", async ({ page }) => {
  await allowProviderFeatures(page);
  await page.route("**/v1/test-videos/*/classify", route => route.fulfill({ status: 503, json: { detail: "Classification disabled in this tracking test" } }));
  await page.route("**/v1/test-videos/*/track", route => route.fulfill({ json: {
    video_id: "delivery-day", detector: "Fixture person track",
    points: [0, 1, 2, 4, 4.2].map((t_seconds, index) => ({ t_seconds, foot_x_norm: [.1, .5, .9, .1, .4][index], foot_y_norm: .4, confidence: .9 })),
  } }));
  await openDemo(page);
  await page.getByRole("complementary", { name: "Home activity" })
    .getByRole("button", { name: /Open .* feed and select it on map/ }).first().click();
  await page.getByRole("button", { name: "Test delivery videos" }).click();
  await expect(page.locator(".test-video-status strong")).toContainText("Person track ready");
  const video = page.locator(".test-video-stage video");
  const seek = async (at: number) => {
    await video.evaluate((element: HTMLVideoElement, time) => new Promise<void>(resolve => {
      element.pause();
      element.addEventListener("seeked", () => resolve(), { once: true });
      element.currentTime = time;
    }), at);
  };
  await video.evaluate(async (element: HTMLVideoElement) => { element.playbackRate = 2; await element.play(); });
  await expect.poll(() => page.locator(".estimated-trail-segment").count()).toBeGreaterThan(0);
  await video.evaluate((element: HTMLVideoElement) => element.pause());
  const segments = await page.locator(".estimated-trail-segment").count();
  await expect(page.locator(".map-actor")).toHaveCount(1);
  await seek(3);
  await expect(page.locator(".map-actor")).toHaveCount(0);
  await expect(page.locator(".test-video-status strong")).toHaveText("Detection lost - position unknown");
  await expect(page.locator(".estimated-trail-segment")).toHaveCount(segments);
  await seek(4.1);
  await expect(page.locator(".map-actor")).toHaveCount(1);
  await page.getByRole("button", { name: "3D", exact: true }).click();
  await expect(page.locator(".spatial-scene")).toHaveAttribute("aria-label", /approximate movement trail/);
  await seek(6);
  await expect(page.locator(".spatial-scene")).toHaveAttribute("aria-description", "Estimated path retained. Person not currently visible.");
  await expect(page.locator(".test-video-status strong")).toHaveText("No longer visible - position unknown");
  await page.screenshot({ path: `${output}/retained-path-3d.png`, fullPage: true });
  await seek(1);
  await expect(page.locator(".spatial-scene")).toHaveAttribute("aria-label", /approximate movement trail/);
  await page.getByRole("button", { name: "2D", exact: true }).click();
  await expect(page.locator(".map-actor")).toHaveCount(1);
  await video.evaluate(async (element: HTMLVideoElement) => {
    element.currentTime = element.duration - .25;
    await element.play();
  });
  await expect(page.locator(".test-video-status strong")).toHaveText("Replay complete - no current position");
  await expect(page.locator(".map-actor, .approximate-marker-uncertainty")).toHaveCount(0);
  await expect(page.locator(".estimated-trail-segment")).toHaveCount(segments);
  await page.screenshot({ path: `${output}/retained-path-2d.png`, fullPage: true });
  await page.getByRole("button", { name: "Night delivery" }).click();
  await expect(page.locator(".estimated-trail-segment")).toHaveCount(0);
});

test("phone navigation, pairing and disconnected state", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openDemo(page);
  await expect(
    page.getByRole("heading", { name: "Home", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: path.join(output, "web-phone.png"),
    fullPage: true,
  });
  const map = page.locator(".spatial-map").first();
  const viewBoxBefore = await map.getAttribute("viewBox");
  await map.hover();
  await page.mouse.wheel(0, -260);
  await expect.poll(() => map.getAttribute("viewBox")).not.toBe(viewBoxBefore);
  await expect(page.getByRole("button", { name: /Connect Ring cameras/ })).toBeVisible();
  await page.getByRole("button", { name: /Connect Ring cameras/ }).click();
  await expect(page.getByRole("heading", { name: "Connect and pair Ring cameras" })).toBeVisible();
  await expect(page.locator(".ring-setup-page").getByRole("heading", { name: /Ring connection|Allow Ring camera access/ })).toBeVisible();
  await page.locator(".ring-setup-page .back-button").click();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Account", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.getByRole("button", { name: "Cameras", exact: true }).click();
  await expect(page.getByRole("heading", { name: "CCTVs" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Camera feed", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Incident report" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add camera", exact: true })).toHaveCount(0);
  expect(
    await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight),
  ).toBeTruthy();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Create pairing code" }).click();
  await expect(page.getByLabel("Pairing code")).toHaveText(/^[A-F0-9]{12}$/);
  await context.setOffline(true);
  await expect(
    page.getByRole("status").filter({ hasText: "Disconnected" }),
  ).toBeVisible({ timeout: 20000 });
  await context.setOffline(false);
  await page.getByRole("button", { name: "Refresh workspace" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Disconnected" }),
  ).toHaveCount(0);
});
test("empty incidents and failed evidence are explicit", async ({ page }) => {
  await openDemo(page);
  await page.route("**/v1/sites/*/incidents", (r) =>
    r.fulfill({ json: { incidents: [], next_cursor: null } }),
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "No incidents yet" }),
  ).toBeVisible();
  await page.unroute("**/v1/sites/*/incidents");
  await page.getByRole("button", { name: "Refresh workspace" }).click();
  await page.route("**/v1/evidence/*/image", (r) =>
    r.fulfill({ status: 503, json: { detail: "Unavailable" } }),
  );
  await page
    .getByRole("button", { name: /Activity observed near the entry/ })
    .first()
    .click();
  await expect(
    page.getByText(
      "Evidence unavailable. Reconnect and select the observation again.",
    ),
  ).toBeVisible();
});

test("place and aim a camera without showing physical camera controls", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openDemo(page);
  const map = page.locator(".spatial-map");
  await expect(map).toBeVisible();
  const before = await map.locator(".camera-group").count();
  await page.getByRole("button", { name: "Add camera", exact: true }).click();
  await expect(page.getByText("Click the plan to place a camera")).toBeVisible();
  const box = (await map.boundingBox())!;
  const createdResponse = page.waitForResponse((response) =>
    response.url().endsWith("/cameras") && response.request().method() === "POST",
  );
  await page.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.55);
  const createdSite = await (await createdResponse).json();
  const createdCamera = createdSite.layout.cameras.at(-1);
  await expect(map.locator(".camera-group")).toHaveCount(before + 1, {
    timeout: 20000,
  });
  // Map geometry remains editable by dragging. The live CCTV card does not
  // imply that a fixed Ring camera supports pan, tilt or range controls.
  const aim = map.locator(".camera-aim-handle").first();
  await expect(aim).toBeVisible();
  const start = (await aim.boundingBox())!;
  const handle = (await aim.boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.3, { steps: 12 });
  await page.mouse.up();
  await expect
    .poll(async () => {
      const moved = await aim.boundingBox();
      return moved ? Math.round(Math.hypot(moved.x - start.x, moved.y - start.y)) : 0;
    }, { timeout: 20000 })
    .toBeGreaterThan(5);
  await expect(page.getByRole("slider", { name: "Aim" })).toHaveCount(0);
  await expect(page.getByRole("slider", { name: "Range" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Turn left" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Turn right" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Home map" }).locator(".map-camera-panel")).toHaveCount(0);
  await page.evaluate(async ({ siteId, cameraId }) => {
    const response = await fetch(`/v1/sites/${siteId}/cameras/${cameraId}`, {
      method: "DELETE",
      headers: { "X-SpatialGuard-Local": "1" },
    });
    if (!response.ok) throw new Error(`Camera cleanup failed: ${response.status}`);
  }, { siteId: createdSite.id, cameraId: createdCamera.id });
  await page.reload();
  await expect(map.locator(".camera-group")).toHaveCount(before, {
    timeout: 20000,
  });
  expect(errors).toEqual([]);
});

test("selecting on the plan draws no browser focus ring", async ({ page }) => {
  await openDemo(page);
  // Chromium paints `outline-style: auto` on a focused SVG <g> for plain :focus,
  // which traced a heavy ring over the whole room. Mouse selection must stay clean.
  await page.getByRole("button", { name: "Kitchen", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle),
    )
    .toBe("none");
  await page.locator(".camera-marker").first().click();
  expect(
    await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle),
  ).toBe("none");
  // Keyboard focus must still be visible.
  await page.keyboard.press("Tab");
  // Compare against the theme token rather than a literal, so a palette change
  // is not mistaken for a lost focus indicator.
  const focused = await page.evaluate(() => {
    const polygon = document.activeElement!.querySelector("polygon");
    if (!polygon) return { stroke: "none", width: "none", alert: "" };
    const probe = document.createElement("span");
    probe.style.color = "var(--alert)";
    document.body.append(probe);
    const alert = getComputedStyle(probe).color;
    probe.remove();
    const style = getComputedStyle(polygon);
    return { stroke: style.stroke, width: style.strokeWidth, alert };
  });
  expect(focused.stroke).toBe(focused.alert);
  expect(focused.width).toBe("0.1px");
});

test("trace a floor plan into a reviewable 2D and 3D map", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openDemo(page);
  await page.getByRole("button", { name: /Floor plan/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await page.setInputFiles(
    'input[aria-label="Floor plan image"]',
    path.resolve("tests/fixtures/plan.png"),
  );
  // Vision is opt-in and discloses the upload before it happens. This suite traces
  // locally so it never sends the drawing anywhere or bills the OpenAI account.
  const useVision = dialog.getByRole("checkbox", { name: /GPT Sol/ });
  await expect(useVision).toBeVisible();
  if (await useVision.isChecked())
    await expect(dialog.getByText(/uploads your floor plan to OpenAI/)).toBeVisible();
  await useVision.uncheck();
  await expect(useVision).not.toBeChecked();
  await expect(dialog.getByText(/uploads your floor plan to OpenAI/)).toBeHidden();
  await expect(dialog.getByText(/the drawing stays on this PC/)).toBeVisible();
  await page.getByRole("button", { name: "Trace floor plan" }).click();
  // Tracing runs in TwinForge's worker, so allow for the queue.
  await expect(page.getByRole("button", { name: "Use this map" })).toBeVisible({
    timeout: 60000,
  });
  await expect(dialog.getByText(/3 spaces · 2 connections/)).toBeVisible();
  await expect(dialog.getByText("Traced locally on this PC.")).toBeVisible();
  await expect(dialog.locator(".spatial-map polygon")).toHaveCount(3);
  // The drawing shows through behind the traced geometry.
  await expect(dialog.locator(".spatial-map image")).toBeVisible();
  await dialog.getByRole("button", { name: "3D", exact: true }).click();
  await expect(dialog.locator(".spatial-scene canvas")).toBeVisible();

  // Scale must be measured: two dimensions that contradict the drawing are refused.
  const width = dialog.getByLabel("Overall width (m)");
  const depth = dialog.getByLabel("Overall depth (m)");
  await expect(width).not.toHaveValue("");
  await depth.fill("3");
  await dialog.getByRole("button", { name: "Use this map" }).click();
  await expect(dialog.getByRole("alert")).toContainText("disagree with the drawing");
  // Nothing was added to the workspace.
  await dialog.getByRole("button", { name: "Discard" }).click();
  await expect(dialog.getByRole("button", { name: "Trace floor plan" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("the chosen place reopens on reload instead of resetting", async ({ page }) => {
  await openDemo(page);
  const chooser = page.locator("select.site-name");
  // With more than one place, switching must survive a reload.
  if (await chooser.count()) {
    const options = await chooser.locator("option").allTextContents();
    const other = options.find((o) => o !== "Demo home");
    if (other) {
      await chooser.selectOption({ label: other });
      await expect(page.locator(".spatial-map")).toBeVisible();
      await page.reload();
      await expect(page.locator("select.site-name option:checked")).toHaveText(other, {
        timeout: 30000,
      });
      await chooser.selectOption({ label: "Demo home" });
    }
  }
  await page.reload();
  await expect(page.locator(".spatial-map")).toBeVisible({ timeout: 30000 });
  // The empty screen must not come back once a place exists.
  await expect(page.getByRole("heading", { name: "No floor plan yet" })).toHaveCount(0);
});

test("camera workspace starts mapped live view and contains its scrolling", async ({ page }) => {
  await page.route("**/v1/ring", (route) =>
    route.fulfill({
      json: {
        configured: true,
        state: "connected",
        public_url: "https://gateway.example.test",
      },
    }),
  );
  await openDemo(page);
  await page.unroute("**/v1/ring/devices/*/streams");
  let liveRequests = 0;
  await page.route("**/v1/ring/devices/*/streams", (route) => {
    liveRequests += 1;
    return route.fulfill({
      status: 409,
      json: { detail: "Live view is unavailable for this Ring device" },
    });
  });
  const demo = await page.evaluate(async () => {
    const sites = await fetch("/v1/sites").then((response) => response.json());
    return sites.find((candidate: { name: string }) => candidate.name === "Demo home");
  });
  const front = demo.layout.cameras[0];
  await page.route("**/v1/ring/devices", (route) =>
    route.fulfill({
      json: [
        {
          id: "mapped-front-door",
          name: "Front Door",
          status: { online: true },
          capabilities: {},
          checked_at: new Date().toISOString(),
          site_id: demo.id,
          camera_id: front.id,
        },
      ],
    }),
  );
  await page.getByRole("button", { name: "Cameras", exact: true }).click();

  const display = page.getByRole("region", { name: "Camera feed", exact: true });
  const rail = page.getByRole("complementary", { name: "Camera feed list" });
  const [displayBox, railBox] = await Promise.all([
    display.boundingBox(),
    rail.boundingBox(),
  ]);
  expect(railBox!.x).toBeGreaterThan(displayBox!.x + displayBox!.width);
  await expect(page.getByRole("region", { name: "Incident report" })).toHaveCount(0);
  expect(displayBox!.height).toBeGreaterThan(400);
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBeTruthy();

  await page.getByRole("button", { name: `View ${front.name}` }).click();
  await expect(page.getByRole("button", { name: `View ${front.name}` })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator(".cctv-thumb img").first()).toBeVisible();
  await expect(page.getByLabel("Live video from Front Door")).toBeVisible();
  await expect(display.getByRole("status")).toHaveText(
    "Live view is unavailable for this Ring device",
    { timeout: 10000 },
  );
  await expect(display.getByRole("button", { name: "Reconnect" })).toBeVisible();
  await page.waitForTimeout(1800);
  expect(liveRequests).toBe(1);
  await expect(page.locator(".cctv-camera-scroll")).toHaveCSS("overflow-y", "auto");
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(page.locator(".camera-marker[aria-pressed=true]")).toHaveCount(1);
});

test("with no place, only the map card is empty", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // Report no places, whatever this machine's workspace actually holds.
  await page.route("**/v1/sites", (r) => r.fulfill({ json: [] }));
  await page.goto("/");
  // The rest of the app still loads around the empty card.
  await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible();
  for (const tab of ["Home", "Incidents", "Cameras", "Settings"])
    await expect(page.getByRole("button", { name: tab, exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recent incidents" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ground floor" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No floor plan yet" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Upload floor plan" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Load sample", exact: true })).toBeVisible();
  // It is an empty state, not an error, and nothing offers to act on a missing place.
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.locator(".spatial-map")).toHaveCount(0);
  await expect(page.locator(".monitor-bar")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Run replay" })).toBeDisabled();
  await page.getByRole("button", { name: "Cameras", exact: true }).click();
  await expect(page.getByRole("button", { name: "Add camera" })).toHaveCount(0);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByText("no place selected")).toBeVisible();
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await page.getByRole("button", { name: "Upload floor plan" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Load sample instead" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("the demo home can be loaded or switched to from Settings", async ({ page }) => {
  await openDemo(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Places" })).toBeVisible();
  // Once it exists the control selects it rather than making another.
  const demo = page.getByRole("button", { name: "Switch to demo home" });
  await expect(demo).toBeVisible();
  // Session rows load independently from places and Ring inventory. Wait for
  // that request before recording the baseline count.
  await expect(page.getByText("Local owner browser").first()).toBeVisible();
  const before = await page.locator(".settings-page .session-row").count();
  await demo.click();
  await expect(page.locator(".spatial-map")).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.locator(".settings-page .session-row")).toHaveCount(before);
  // It is also reachable with no place at all.
  await page.route("**/v1/sites", (r) => r.fulfill({ json: [] }));
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("button", { name: "Load demo home" })).toBeVisible();
  await expect(page.getByText("No places yet.")).toBeVisible();
});

test("setup guide explains consent, maps, and evidence on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/workspace");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Open setup guide" }).click();
  const guide = page.getByRole("dialog", { name: "SpatialGuard setup" });
  await expect(guide.getByRole("heading", { name: "One place to understand camera events" })).toBeVisible();
  await guide.getByRole("button", { name: "Continue" }).click();
  await expect(guide.getByText("Use authorized Ring data")).toBeVisible();
  await guide.getByRole("button", { name: "Continue" }).click();
  await expect(guide.getByRole("heading", { name: "Add a floor plan, then place each camera" })).toBeVisible();
  await guide.getByRole("button", { name: "Continue" }).click();
  await expect(guide.getByText("Unknown gap")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: path.join(output, "onboarding-phone.png") });
  await guide.getByRole("button", { name: "Skip setup" }).click();
  await expect(guide).toHaveCount(0);
});

test("dialogs trap keyboard focus and close without stranding focus", async ({ page }) => {
  await page.goto("/workspace");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Open setup guide" }).click();
  const dialog = page.getByRole("dialog", { name: "SpatialGuard setup" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Skip setup" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: /Continue/ })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  await page.getByTitle("Map from a floor plan").click();
  const importer = page.getByRole("dialog", { name: "Map from a floor plan" });
  await expect(importer).toBeVisible();
  await expect(importer.getByRole("button", { name: "Close" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(importer).toHaveCount(0);
});

test("recoverable failures explain the cause, effect, and next action", async ({ page }) => {
  let attempts = 0;
  await page.route("**/v1/sites", async route => {
    attempts += 1;
    if (attempts === 1) {
      await route.fulfill({
        status: 503,
        json: { detail: "Provider connection timed out" },
      });
      return;
    }
    await route.continue();
  });
  await page.goto("/workspace");
  const notice = page.getByRole("alert");
  await expect(notice.getByText("SpatialGuard could not reach the service")).toBeVisible();
  await expect(notice.getByText(/may be stale/)).toBeVisible();
  await expect(notice.getByText("Check your connection and try again.")).toBeVisible();
  await notice.getByRole("button", { name: "Try again" }).click();
  await expect(notice).toHaveCount(0);
});

test("Luna classification is opt-in and explains snapshot handling", async ({ page }) => {
  await allowProviderFeatures(page);
  await page.route("**/v1/classifier", (route) =>
    route.fulfill({
      json: { configured: true, model: "gpt-5.6-luna" },
    }),
  );
  await openDemo(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Luna incident classification" }),
  ).toBeVisible();
  await expect(page.getByText("sends one authorized camera snapshot", { exact: false })).toBeVisible();
  await expect(page.getByText("does not identify people or infer gender", { exact: false })).toBeVisible();
  await expect(page.getByText("gpt-5.6-luna is configured", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: /Luna classification/ })).toBeEnabled();
});

test("spaces and cameras can be renamed in place", async ({ page }) => {
  await openDemo(page);
  const panel = page.locator(".map-camera-panel");
  // A traced plan calls its spaces "Space 02"; the owner must be able to fix that.
  await page.getByRole("button", { name: "Study", exact: true }).click();
  await expect(panel.getByText("Study")).toBeVisible();
  await page.getByRole("button", { name: "Rename Study" }).click();
  const space = page.getByRole("textbox", { name: "Space name" });
  await space.fill("Nursery");
  await space.press("Enter");
  await expect(page.getByRole("button", { name: "Nursery", exact: true })).toBeVisible({
    timeout: 30000,
  });
  // Escape abandons an edit rather than committing it.
  await page.getByRole("button", { name: "Rename Nursery" }).click();
  const again = page.getByRole("textbox", { name: "Space name" });
  await again.fill("Discarded");
  await again.press("Escape");
  await expect(panel.getByText("Nursery")).toBeVisible();
  await page.getByRole("button", { name: "Rename Nursery" }).click();
  const restore = page.getByRole("textbox", { name: "Space name" });
  await restore.fill("Study");
  await restore.press("Enter");
  await expect(page.getByRole("button", { name: "Study", exact: true })).toBeVisible({
    timeout: 30000,
  });
});

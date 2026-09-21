// The browser suite runs against the real local workspace, so it must leave it
// exactly as it found it. Places the tests create are removed afterwards.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const BASE = "http://127.0.0.1:8010";
// Not under test-results: Playwright clears that directory when a run starts,
// which would erase the record before the teardown could read it.
const RECORD = path.join(os.tmpdir(), "spatialguard-sites-before.json");

async function session() {
  const response = await fetch(BASE + "/v1/local-session", {
    method: "POST",
    headers: { "X-SpatialGuard-Local": "1", Origin: BASE },
  });
  return response.headers.getSetCookie?.().join("; ") ?? "";
}
async function siteIds(cookie: string) {
  const response = await fetch(BASE + "/v1/sites", {
    headers: { "X-SpatialGuard-Local": "1", Cookie: cookie },
  });
  if (!response.ok) return [];
  return (await response.json()).map((s: { id: string }) => s.id) as string[];
}

export default async function globalSetup() {
  try {
    const cookie = await session();
    fs.mkdirSync(path.dirname(RECORD), { recursive: true });
    fs.writeFileSync(RECORD, JSON.stringify({ cookie, ids: await siteIds(cookie) }));
  } catch {
    // No workspace running: the suite will fail on its own with a clearer message.
  }
}

export async function globalTeardown() {
  try {
    const { cookie, ids } = JSON.parse(fs.readFileSync(RECORD, "utf8"));
    for (const id of await siteIds(cookie)) {
      if (ids.includes(id)) continue;
      await fetch(`${BASE}/v1/sites/${id}`, {
        method: "DELETE",
        headers: { "X-SpatialGuard-Local": "1", Origin: BASE, Cookie: cookie },
      });
    }
    fs.rmSync(RECORD, { force: true });
  } catch {
    // Nothing recorded means nothing to undo.
  }
}

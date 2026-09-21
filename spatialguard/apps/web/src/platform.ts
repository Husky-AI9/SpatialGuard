import { Capacitor, CapacitorHttp, registerPlugin } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
interface SecureSessionPlugin {
  read(): Promise<{ token: string; apiUrl: string }>;
  write(value: { token: string }): Promise<void>;
  clear(): Promise<void>;
}
const secure = registerPlugin<SecureSessionPlugin>("SecureSession");
export const native = Capacitor.isNativePlatform();
export const localWeb = !native && ["127.0.0.1", "localhost"].includes(window.location.hostname);
let credential = "",
  apiUrl = "";
export async function initializePlatform() {
  if (native) {
    const value = await secure.read();
    credential = value.token;
    apiUrl = value.apiUrl;
    if (!apiUrl)
      throw new Error(
        "This release has no hosted backend configured. Use the local debug preview.",
      );
  }
  return !native || credential.length > 0;
}
export async function storeToken(token: string) {
  await secure.write({ token });
  credential = token;
}
export async function clearToken() {
  credential = "";
  if (native) await secure.clear();
}
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function request<T>(
  path: string,
  method = "GET",
  body?: unknown,
  timeoutMs = 15000,
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(native
      ? {
          "X-SpatialGuard-Client": "android",
          ...(credential ? { Authorization: `Bearer ${credential}` } : {}),
        }
      : localWeb ? { "X-SpatialGuard-Local": "1" } : {}),
  };
  let status: number, data: unknown;
  if (native) {
    const result = await CapacitorHttp.request({
      url: apiUrl + path,
      method,
      headers,
      data: body,
      connectTimeout: 10000,
      readTimeout: timeoutMs,
    });
    status = result.status;
    data = result.data;
  } else {
    const response = await fetch(path, {
      method,
      headers,
      credentials: "same-origin",
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    status = response.status;
    data = response.status === 204 ? null : await response.json();
  }
  if (status >= 400)
    throw new ApiError(
      status,
      typeof (data as any)?.detail === "string"
        ? (data as any).detail
        : "Request failed. Please try again.",
    );
  return data as T;
}
export async function evidenceImage(id: string) {
  const path = `/v1/evidence/${id}/image`;
  if (native) {
    const r = await CapacitorHttp.get({
      url: apiUrl + path,
      headers: { Authorization: `Bearer ${credential}` },
      responseType: "text",
    });
    if (r.status !== 200) throw new ApiError(r.status, "Evidence unavailable");
    return URL.createObjectURL(new Blob([r.data], { type: "image/svg+xml" }));
  }
  const r = await fetch(path, { credentials: "same-origin" });
  if (!r.ok) throw new ApiError(r.status, "Evidence unavailable");
  return URL.createObjectURL(await r.blob());
}
export async function floorPlanImage(siteId: string) {
  const path = `/v1/sites/${siteId}/floor-plan`;
  if (native) {
    const r = await CapacitorHttp.get({
      url: apiUrl + path,
      headers: { Authorization: `Bearer ${credential}` },
      responseType: "blob",
    });
    if (r.status !== 200) throw new ApiError(r.status, "Floor plan unavailable");
    const bytes = Uint8Array.from(atob(r.data), (c) => c.charCodeAt(0));
    return URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
  }
  const r = await fetch(path, { credentials: "same-origin" });
  if (!r.ok) throw new ApiError(r.status, "Floor plan unavailable");
  return URL.createObjectURL(await r.blob());
}
export async function ringSnapshot(siteId: string, cameraId: string) {
  const path = `/v1/ring/sites/${encodeURIComponent(siteId)}/cameras/${encodeURIComponent(cameraId)}/snapshot`;
  if (native) {
    const r = await CapacitorHttp.get({
      url: apiUrl + path,
      headers: { Authorization: `Bearer ${credential}` },
      responseType: "blob",
      connectTimeout: 10000,
      readTimeout: 20000,
    });
    if (r.status !== 200) throw new ApiError(r.status, "Snapshot unavailable");
    const bytes = Uint8Array.from(atob(r.data), (c) => c.charCodeAt(0));
    return URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" }));
  }
  const r = await fetch(path, {
    credentials: "same-origin",
    headers: localWeb ? { "X-SpatialGuard-Local": "1" } : {},
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new ApiError(r.status, "Snapshot unavailable");
  return URL.createObjectURL(await r.blob());
}
export async function openExternal(url: string) {
  if (native) await Browser.open({ url });
  else window.open(url, "_blank", "noopener,noreferrer");
}
export async function lifecycle(onResume: () => void, onBack: () => boolean) {
  if (!native) return () => {};
  const resume = await App.addListener("appStateChange", ({ isActive }) => {
    if (isActive) onResume();
  });
  const back = await App.addListener("backButton", () => {
    if (!onBack()) void App.minimizeApp();
  });
  return () => {
    void resume.remove();
    void back.remove();
  };
}

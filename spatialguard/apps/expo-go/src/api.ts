import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import type { components } from "../../web/src/generated";
export type Site = components["schemas"]["Site"];
export type Incident = components["schemas"]["Incident"];
export type Device = components["schemas"]["RingDevice"];
export type Session = components["schemas"]["Session"];
export type Track = components["schemas"]["TestVideoTrack"];
export const ORIGIN = "https://spatialguard-production.up.railway.app";
let token = "";
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const authHeaders = () => ({
  Authorization: `Bearer ${token}`,
  "X-SpatialGuard-Client": Platform.OS === "android" ? "android" : "ios",
});
export async function restore() {
  token = (await SecureStore.getItemAsync("spatialguard.session")) || "";
  return !!token;
}
export async function save(value: string) {
  await SecureStore.setItemAsync("spatialguard.session", value);
  token = value;
}
export async function forget() {
  token = "";
  await SecureStore.deleteItemAsync("spatialguard.session");
}
export async function request<T>(
  path: string,
  method = "GET",
  body?: unknown,
  timeoutMs = 25000,
): Promise<T> {
  if (!path.startsWith("/v1/")) throw new Error("Invalid API path");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(ORIGIN + path, {
      method,
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const data = response.status === 204 ? null : await response.json();
    if (!response.ok)
      throw new ApiError(
        response.status,
        typeof data?.detail === "string"
          ? data.detail
          : "Request failed. Please try again.",
      );
    return data;
  } finally {
    clearTimeout(timer);
  }
}

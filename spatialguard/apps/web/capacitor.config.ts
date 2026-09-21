import type { CapacitorConfig } from "@capacitor/cli";
const config: CapacitorConfig = {
  appId: "app.spatialguard.mobile",
  appName: "SpatialGuard",
  webDir: "dist",
  loggingBehavior: "none",
  server: { androidScheme: "https" },
};
export default config;

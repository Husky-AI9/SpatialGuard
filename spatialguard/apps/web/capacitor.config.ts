import type { CapacitorConfig } from "@capacitor/cli";
const config: CapacitorConfig = {
  appId: "dev.spatialguard.preview",
  appName: "SpatialGuard",
  webDir: "dist",
  loggingBehavior: "none",
  server: { androidScheme: "https" },
};
export default config;

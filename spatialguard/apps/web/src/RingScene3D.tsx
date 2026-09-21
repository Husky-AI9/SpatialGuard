import { useCallback, useEffect, useState, type ComponentProps } from "react";
import Scene3D, { type CameraModelFactory } from "@twinforge/spatial-view/Scene3D";
import { ringCameraModel } from "./ringCameraModels";
import { request } from "./platform";
import type { components } from "./generated";

type Device = components["schemas"]["RingDevice"];

// Provider-specific presentation stays in SpatialGuard, outside TwinForge's
// layout contract and the reusable map renderer. This module loads with 3D.
export default function RingScene3D({ siteId, ...props }: ComponentProps<typeof Scene3D> & { siteId: string }) {
  const [devices, setDevices] = useState<Device[]>([]);
  useEffect(() => {
    let active = true;
    setDevices([]);
    void request<Device[]>("/v1/ring/devices")
      .then(inventory => { if (active) setDevices(inventory); })
      .catch(() => { if (active) setDevices([]); });
    return () => { active = false; };
  }, [siteId]);
  const factory = useCallback<CameraModelFactory>((id, active, heading, mount) => {
    const device = devices.find(d => d.site_id === siteId && d.camera_id === id);
    return ringCameraModel(device?.hardware_model ?? "stick_up_cam", id, active, heading, mount);
  }, [devices, siteId]);
  return <Scene3D {...props} cameraModelFactory={factory} />;
}

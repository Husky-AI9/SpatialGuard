import { useEffect, useState } from "react";
import { Camera } from "lucide-react";
import { ringSnapshot } from "./platform";

export default function CameraThumbnail({
  siteId,
  cameraId,
  name,
  available,
  className,
  iconSize = 20,
}: {
  siteId?: string;
  cameraId: string;
  name: string;
  available: boolean;
  className: string;
  iconSize?: number;
}) {
  const [source, setSource] = useState("");

  useEffect(() => {
    let active = true;
    let objectUrl = "";
    setSource("");
    if (siteId && available) {
      void ringSnapshot(siteId, cameraId)
        .then((url) => {
          objectUrl = url;
          if (active) setSource(url);
          else URL.revokeObjectURL(url);
        })
        .catch(() => {
          // A camera can be connected without having a recent image. Keep the
          // neutral camera glyph rather than presenting a stale placeholder.
        });
    }
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [available, cameraId, siteId]);

  return (
    <span className={className}>
      {source ? (
        <img src={source} alt={`Latest available snapshot from ${name}`} />
      ) : (
        <Camera size={iconSize} aria-hidden="true" />
      )}
    </span>
  );
}

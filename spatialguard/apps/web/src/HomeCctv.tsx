import { useEffect, useState } from "react";
import { Camera, Radio, VideoOff } from "lucide-react";
import type { Camera as PlacedCamera } from "../../../../packages/sdk-typescript";
import CameraThumbnail from "./CameraThumbnail";
import { LiveVideo } from "./RingConnection";
import TestVideoReplay, { type TestTrack } from "./TestVideoReplay";
import type { components } from "./generated";
import { request } from "./platform";

type Device = components["schemas"]["RingDevice"];
type RingStatus = components["schemas"]["RingStatus"];
type CameraStatus = components["schemas"]["CameraStatus"];
type IncidentClassification = components["schemas"]["IncidentClassification"];

export default function HomeCctv({
  siteId,
  cameras,
  selected,
  onSelect,
  onClear,
  onViewAll,
  onPairCamera,
  onTestTrack,
  onTestClassification,
  classificationEnabled,
}: {
  siteId?: string;
  cameras: CameraStatus[];
  selected?: PlacedCamera;
  onSelect: (cameraId: string) => void;
  onClear: () => void;
  onViewAll: () => void;
  onPairCamera: () => void;
  onTestTrack: (track: TestTrack | null) => void;
  onTestClassification: (classification: IncidentClassification | null) => void;
  classificationEnabled: boolean;
}) {
  const [ringState, setRingState] = useState("loading");
  const [devices, setDevices] = useState<Device[]>([]);
  const [liveDevice, setLiveDevice] = useState<Device | null>(null);
  const [source, setSource] = useState<"live" | "test">("live");

  useEffect(() => {
    let active = true;
    void request<RingStatus>("/v1/ring")
      .then(async (status) => {
        if (!active) return;
        setRingState(status.state);
        const inventory = status.state === "connected"
          ? await request<Device[]>("/v1/ring/devices")
          : [];
        if (active) setDevices(inventory);
      })
      .catch(() => {
        if (active) setRingState("unavailable");
      });
    return () => {
      active = false;
    };
  }, [siteId]);

  const mappedDevice = (cameraId: string) =>
    devices.find(
      (device) => device.site_id === siteId && device.camera_id === cameraId,
    );

  useEffect(() => {
    setLiveDevice(selected ? (mappedDevice(selected.id) ?? null) : null);
    setSource("live");
    onTestTrack(null);
    onTestClassification(null);
  }, [devices, selected?.id, siteId]);

  if (selected) {
    const ring = mappedDevice(selected.id);
    return (
      <section className="home-cctv home-cctv-open" aria-label="CCTV overview">
        <div className="panel-heading">
          <div>
            <h2>{selected.name}</h2>
            <span>{ring ? "Ring camera" : "Floor-plan camera"}</span>
          </div>
          <button className="primary" onClick={onClear}>All cameras</button>
        </div>
        <div className="cctv-source-tabs" aria-label="Camera source">
          <button
            aria-pressed={source === "live"}
            onClick={() => {
              setSource("live");
              onTestTrack(null);
              if (ring) setLiveDevice(ring);
            }}
          >
            Live camera
          </button>
          <button
            aria-pressed={source === "test"}
            onClick={() => {
              setSource("test");
              setLiveDevice(null);
            }}
          >
            Test delivery videos
          </button>
        </div>
        <div className="home-cctv-stage">
          {source === "test" ? (
            <TestVideoReplay
              camera={selected}
              classificationEnabled={classificationEnabled}
              onTrack={onTestTrack}
              onClassification={onTestClassification}
            />
          ) : liveDevice ? (
            <LiveVideo
              key={liveDevice.id}
              device={liveDevice}
              embedded
              close={() => setLiveDevice(null)}
            />
          ) : (
            <div className="home-cctv-empty">
              {ring ? <Radio size={25} /> : <VideoOff size={25} />}
              <strong>{ring ? "Live view stopped" : "Replay camera"}</strong>
              <span>
                {ring
                  ? "Select this camera again to reopen its live feed."
                  : "No Ring feed is mapped to this camera."}
              </span>
              {ring && (
                <button onClick={() => setLiveDevice(ring)}>Open live view</button>
              )}
            </div>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="home-cctv" aria-label="CCTV overview">
      <div className="panel-heading">
        <div>
          <h2>CCTVs</h2>
          <span>{cameras.length} devices</span>
        </div>
        <button className="primary" onClick={onViewAll}>View all</button>
      </div>
      <div className="home-camera-scroll">
        {cameras.map((camera) => {
          const ring = mappedDevice(camera.id);
          return (
            <div className="home-camera-row" key={camera.id}>
              <button
                className="home-camera-select"
                onClick={() => onSelect(camera.id)}
                aria-label={`Open ${camera.name} feed and select it on map`}
              >
                <CameraThumbnail
                  className="home-camera-thumb"
                  siteId={siteId}
                  cameraId={camera.id}
                  name={camera.name}
                  available={!!ring}
                  iconSize={19}
                />
                <span>
                  <strong>{camera.name}</strong>
                  <small>{ring ? "Ring camera" : "Floor-plan camera"}</small>
                  <em>
                    {ring
                      ? "Live available"
                      : ringState === "loading"
                        ? "Checking feed"
                        : "Not paired"}
                  </em>
                </span>
              </button>
              {!ring && ringState !== "loading" && (
                <button className="pair-camera-button" onClick={onPairCamera}>Pair</button>
              )}
            </div>
          );
        })}
        {!cameras.length && (
          <div className="cctv-no-cameras">
            <Camera size={21} />
            <p>No cameras placed yet.</p>
          </div>
        )}
      </div>
    </section>
  );
}

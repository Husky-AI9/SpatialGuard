import { useEffect, useRef, useState } from "react";
import { ApiError, request, openExternal } from "./platform";
import RecoveryNotice from "./RecoveryNotice";
import type { components } from "./generated";
type Status = components["schemas"]["RingStatus"];
type Device = components["schemas"]["RingDevice"];
type Site = {
  id: string;
  name: string;
  layout: { cameras: { id: string; name: string }[] };
};

export function LiveVideo({
  device,
  close,
  embedded = false,
  autoReconnect = true,
}: {
  device: Device;
  close: () => void;
  embedded?: boolean;
  autoReconnect?: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const pinch = useRef<number | null>(null);
  const consecutiveFailures = useRef(0);
  const [message, setMessage] = useState("Opening a bounded live session…");
  const [attempt, setAttempt] = useState(0);
  const [manualReconnect, setManualReconnect] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    if (!fullscreen) return;
    const previousOverflow = document.body.style.overflow;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFullscreen(false);
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", escape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", escape);
    };
  }, [fullscreen]);
  useEffect(() => {
    setManualReconnect(false);
    setMessage(attempt ? "Renewing live session…" : "Opening a bounded live session…");
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    let disposed = false,
      session = "",
      timer: ReturnType<typeof setTimeout> | undefined,
      reconnect: ReturnType<typeof setTimeout> | undefined;
    let polling: ReturnType<typeof setInterval> | undefined;
    const stop = () => {
      disposed = true;
      pc.close();
      clearTimeout(timer);
      clearTimeout(reconnect);
      clearInterval(polling);
      if (video.current) video.current.srcObject = null;
      if (session) {
        const id = session;
        session = "";
        void request(`/v1/ring/streams/${id}`, "DELETE").catch(() => {});
      }
    };
    const retry = (text: string, retryable = true) => {
      if (disposed) return;
      stop();
      setMessage(text);
      if (retryable && autoReconnect && !document.hidden && consecutiveFailures.current < 2) {
        consecutiveFailures.current += 1;
        reconnect = setTimeout(() => setAttempt(value => value + 1), 1400);
      } else {
        setManualReconnect(true);
      }
    };
    const hidden = () => {
      if (document.hidden) {
        stop();
        setMessage("Live view paused while this tab is in the background.");
      } else if (autoReconnect) {
        setMessage("Restoring live view…");
        setAttempt(value => value + 1);
      }
    };
    document.addEventListener("visibilitychange", hidden);
    pc.ontrack = (e) => {
      consecutiveFailures.current = 0;
      const element = video.current;
      if (element) {
        element.srcObject = e.streams[0] ?? new MediaStream([e.track]);
        setMessage("Connecting to camera video…");
        const play = () => void element.play().catch(() => {
          if (!disposed) setMessage("Tap the video to start playback.");
        });
        if (element.readyState >= HTMLMediaElement.HAVE_METADATA) play();
        else element.addEventListener("loadedmetadata", play, { once: true });
      }
    };
    pc.onconnectionstatechange = () => {
      if (["failed", "disconnected"].includes(pc.connectionState)) {
        retry("Connection changed. Requesting another bounded session…");
      }
    };
    void (async () => {
      pc.addTransceiver("video", { direction: "recvonly" });
      await pc.setLocalDescription(await pc.createOffer());
      await new Promise<void>((resolve) => {
        if (pc.iceGatheringState === "complete") return resolve();
        let finished = false;
        const finish = () => {
          if (finished) return;
          finished = true;
          clearTimeout(timeout);
          pc.removeEventListener("icegatheringstatechange", check);
          resolve();
        };
        const timeout = setTimeout(() => {
          // Android WebView can keep ICE gathering open while it waits for a
          // STUN response even though its usable candidates are already in
          // localDescription. Ring accepts this non-trickle SDP offer, so use
          // the candidates collected so far instead of failing before the API
          // ever receives the request.
          finish();
        }, 6000);
        function check() {
          if (pc.iceGatheringState === "complete") finish();
        }
        pc.addEventListener("icegatheringstatechange", check);
      });
      if (disposed) return;
      const r = await request<components["schemas"]["StreamAnswer"]>(
        `/v1/ring/devices/${encodeURIComponent(device.id)}/streams`,
        "POST",
        { sdp: pc.localDescription!.sdp },
      );
      session = r.id;
      if (disposed) {
        stop();
        return;
      }
      await pc.setRemoteDescription({ type: "answer", sdp: r.sdp });
      consecutiveFailures.current = 0;
      timer = setTimeout(
        () => {
          retry(autoReconnect
            ? "Session ended. Requesting another bounded session…"
            : "Session ended. Use reconnect to request another view.");
        },
        Math.max(0, r.expires_at * 1000 - Date.now()),
      );
      polling = setInterval(() => {
        void request<components["schemas"]["StreamState"]>(
          `/v1/ring/streams/${r.id}`,
        )
          .then((s) => {
            if (s.state !== "active") {
              retry(autoReconnect
                ? "Renewing live session…"
                : "Session ended or camera access changed.");
            }
          })
          .catch(() => {
            retry(autoReconnect
              ? "Connection interrupted. Restoring live view…"
              : "Disconnected. Live video stopped.");
          });
      }, 2000);
    })().catch((e) => {
      if (disposed) return;
      const detail = e instanceof Error ? e.message : "Live video unavailable";
      const closingPrevious = e instanceof ApiError && e.status === 409 &&
        detail.includes("already open or closing");
      const temporary = closingPrevious ||
        (e instanceof ApiError && [429, 502, 503, 504].includes(e.status));
      retry(
        closingPrevious
          ? "Finishing the previous session. Reconnecting…"
          : temporary
            ? `${detail} Reconnecting…`
            : detail,
        temporary,
      );
    });
    return () => {
      stop();
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [device.id, attempt, autoReconnect]);
  return (
    <div
      className={`ring-video${embedded ? " embedded" : ""}${fullscreen ? " fullscreen-player" : ""}`}
      role={fullscreen ? "dialog" : undefined}
      aria-label={fullscreen ? `${device.name} fullscreen camera` : undefined}
    >
      <h3>{device.name}</h3>
      <div className="ring-video-viewport">
        <video
          ref={video}
          autoPlay
          playsInline
          muted
          style={{ transform: `scale(${zoom})` }}
          onWheel={(event) => {
            event.preventDefault();
            setZoom(value => Math.max(1, Math.min(3, value + (event.deltaY < 0 ? .2 : -.2))));
          }}
          onTouchStart={(event) => {
            if (event.touches.length === 2)
              pinch.current = Math.hypot(
                event.touches[0].clientX - event.touches[1].clientX,
                event.touches[0].clientY - event.touches[1].clientY,
              );
          }}
          onTouchMove={(event) => {
            if (event.touches.length !== 2 || !pinch.current) return;
            const distance = Math.hypot(
              event.touches[0].clientX - event.touches[1].clientX,
              event.touches[0].clientY - event.touches[1].clientY,
            );
            const change = distance / pinch.current;
            pinch.current = distance;
            setZoom(value => Math.max(1, Math.min(3, value * change)));
          }}
          onTouchEnd={() => { pinch.current = null; }}
          onPlaying={() => setMessage("Live integration · video only · not recorded")}
          onClick={() => void video.current?.play()}
          onDoubleClick={() => setFullscreen(value => !value)}
          aria-label={`Live video from ${device.name}`}
        />
      </div>
      <p role="status">{message}</p>
      <div className="ring-video-actions">
        <button onClick={() => setZoom(value => Math.max(1, value - .25))} aria-label={`Zoom out ${device.name}`}>−</button>
        <span>{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom(value => Math.min(3, value + .25))} aria-label={`Zoom in ${device.name}`}>+</button>
        <button aria-pressed={fullscreen} onClick={() => setFullscreen(value => !value)}>
          {fullscreen ? "Exit fullscreen" : "Fullscreen"}
        </button>
        {(!autoReconnect || manualReconnect) && <button onClick={() => {
          consecutiveFailures.current = 0;
          setAttempt(value => value + 1);
        }}>Reconnect</button>}
        <button onClick={close}>Close live view</button>
      </div>
    </div>
  );
}

export default function RingConnection({ sites, refreshOnReturn = false }: { sites: Site[]; refreshOnReturn?: boolean }) {
  const [status, setStatus] = useState<Status | null>(null),
    [devices, setDevices] = useState<Device[]>([]);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [code, setCode] = useState<components["schemas"]["PairCode"] | null>(null);
  const [view, setView] = useState<Device | null>(null);
  const load = async (refreshInventory = false) => {
    const s = await request<Status>("/v1/ring");
    setStatus(s);
    setDevices(
      s.state === "connected"
        ? await request<Device[]>(refreshInventory ? "/v1/ring/devices/refresh" : "/v1/ring/devices", refreshInventory ? "POST" : "GET")
        : [],
    );
  };
  const act = async (f: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await f();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void act(async () => {
      await load(refreshOnReturn);
      if (refreshOnReturn) {
        const url = new URL(window.location.href);
        url.searchParams.delete("ring");
        window.history.replaceState({}, "", url.pathname + url.search + url.hash);
      }
    });
  }, []);
  const connected = status?.state === "connected";
  const pairedName = (d: Device) => {
    const site = sites.find((x) => x.id === d.site_id);
    return site?.layout.cameras.find((c) => c.id === d.camera_id)?.name;
  };
  return (
    <div className="ring-connection security-page">
      <section className="settings-card">
        <div className="settings-row">
          <h2>Ring connection</h2>
          <em className={connected ? "status-pill ok" : "status-pill"}>
            {connected ? "Connected" : status?.configured === false ? "Unavailable" : "Not linked"}
          </em>
        </div>
        <p className="ring-status-line">
          {connected
            ? "Account connected · Live integration"
            : status?.configured
              ? "Link your Ring account to add cameras."
              : "Ring isn’t available right now."}
        </p>
        {error && <RecoveryNotice message={error} onRetry={() => void act(() => load(true))} retryLabel="Retry Ring" />}
        {!connected && (
          <ol className="ring-steps">
            <li>Open the Ring app store and choose Pathlight.</li>
            <li>Pick the cameras to share, then come back here.</li>
          </ol>
        )}
        {connected && status?.subscription && (
          <div className="settings-row ring-plan" aria-label="Ring plan status">
            <span>
              <strong>
                {status.subscription.state === "active_paid" ? "Ring plan active" :
                  status.subscription.state === "active_trial" ? "Ring trial active" :
                    status.subscription.required ? "Ring plan required" : "No Pathlight plan required"}
              </strong>
              <small>
                {status.subscription.eligible ? "All features are available." : "Your Ring plan ended. Renew it to use cameras here."}
              </small>
            </span>
            <button onClick={() => void openExternal(status.subscription!.manage_url)}>Manage plan</button>
          </div>
        )}
        <div className="button-row">
          {!connected && (
            <button className="primary" disabled={busy || !status?.configured}
              onClick={() => void act(async () => setCode(await request("/v1/ring/sign-in-code", "POST")))}>
              Create Ring sign-in code
            </button>
          )}
          {!connected && <button onClick={() => void openExternal("https://ring.com/appstore")}>Open Ring Appstore</button>}
          {connected ? (
            <button disabled={busy} onClick={() => void act(async () => setDevices(await request("/v1/ring/devices/refresh", "POST")))}>
              Refresh Ring cameras
            </button>
          ) : (
            <button disabled={busy} onClick={() => void act(load)}>Check connection</button>
          )}
          {connected && (
            <button className="quiet-danger" disabled={busy}
              onClick={() => void act(async () => { setView(null); await request("/v1/ring", "DELETE"); await load(); })}>
              Disconnect Ring
            </button>
          )}
        </div>
        {code && (
          <p className="pair-code">
            {code.code}
            <small>Single use · expires {new Date(code.expires_at * 1000).toLocaleTimeString()}</small>
          </p>
        )}
      </section>

      {connected && (
        <section className="settings-card">
          <div className="settings-row">
            <h2>Ring cameras</h2>
            <small className="ring-count">{devices.length} shared</small>
          </div>
          {!devices.length && <p className="activity-empty">No cameras shared yet. Choose cameras in the Ring app, then refresh.</p>}
          <div className="ring-device-list">
            {devices.map((d) => {
              const usable = !!d.support?.live_view && !!d.support?.motion_events;
              const paired = pairedName(d);
              return (
                <div className="ring-device" key={d.id}>
                  <div className="ring-device-head">
                    <span className="ring-device-icon" aria-hidden="true"><span /></span>
                    <span className="ring-device-text">
                      <h3>{d.name}</h3>
                      <small>{usable ? "Live view and motion events" : "Not compatible"}</small>
                    </span>
                    <em className={paired ? "status-pill ok" : "status-pill"}>{paired ? `Paired · ${paired}` : "Not paired"}</em>
                  </div>
                  {d.guidance?.length ? (
                    <div className="ring-guidance" role="status" aria-label={`${d.name} setup guidance`}>
                      <strong>Check this camera in the Ring app</strong>
                      <ul>{d.guidance.map((item) => <li key={item}>{item}</li>)}</ul>
                    </div>
                  ) : null}
                  <div className="ring-device-actions">
                    <label>
                      Paired with
                      <select
                        aria-label={`Floor-plan camera for ${d.name}`}
                        disabled={busy || !d.support?.motion_events}
                        value={d.site_id && d.camera_id ? `${d.site_id}/${d.camera_id}` : ""}
                        onChange={(e) => {
                          const [site_id, camera_id] = e.target.value.split("/");
                          if (site_id)
                            void act(async () => {
                              await request(`/v1/ring/devices/${encodeURIComponent(d.id)}/mapping`, "PUT", { site_id, camera_id });
                              await load();
                            });
                        }}
                      >
                        <option value="" disabled>Choose a camera on your map</option>
                        {sites.flatMap((s) =>
                          s.layout.cameras.map((c) => (
                            <option key={`${s.id}/${c.id}`} value={`${s.id}/${c.id}`}>
                              {sites.length > 1 ? `${s.name} · ` : ""}{c.name}
                            </option>
                          )),
                        )}
                      </select>
                    </label>
                    <button
                      disabled={!d.camera_id || busy || !d.support?.live_view || status?.subscription?.eligible === false}
                      onClick={() => setView(d)}
                    >
                      Open live view
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="fine">Live views last up to 25 seconds and aren’t recorded.</p>
        </section>
      )}
      {view && <LiveVideo key={view.id} device={view} close={() => setView(null)} />}
    </div>
  );
}

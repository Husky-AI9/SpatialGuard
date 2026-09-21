import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  useMemo,
} from "react";
import {
  Shield,
  House,
  History,
  Camera,
  Settings,
  Activity,
  Play,
  ArrowLeft,
  ArrowUpRight,
  Check,
  Pause,
  RefreshCw,
  MapPin,
  Link2,
  Plus,
  X,
  Map,
} from "lucide-react";
import Map2D from "@twinforge/spatial-view/Map2D";
import type { Marker } from "@twinforge/spatial-view/Map2D";
import { bounds } from "@twinforge/spatial-view/geometry";
import type { CameraChange } from "@twinforge/spatial-view/cameraGlyph";
import CameraControls from "./CameraControls";
import RenameField from "./RenameField";
import PlanImporter from "./PlanImporter";
import RingConnection from "./RingConnection";
import CameraWorkspace from "./CameraWorkspace";
import CameraWall from "./CameraWall";
import HomeCctv from "./HomeCctv";
import Operations from "./Operations";
import type { TestTrack } from "./TestVideoReplay";
import type { components } from "./generated";
import type {
  Camera as PlacedCamera,
  Layout,
} from "../../../../packages/sdk-typescript";
import {
  ApiError,
  clearToken,
  evidenceImage,
  floorPlanImage,
  initializePlatform,
  lifecycle,
  localWeb,
  native,
  openExternal,
  request,
  storeToken,
} from "./platform";
const Scene3D = lazy(() => import("./RingScene3D"));
type Site = Omit<components["schemas"]["Site"], "layout"> & { layout: Layout };
type Incident = components["schemas"]["Incident"];
type Run = components["schemas"]["ReplayRun"];
type Session = components["schemas"]["Session"];
type CameraStatus = components["schemas"]["CameraStatus"];
type EventPage = components["schemas"]["EventPage"];
type Page = components["schemas"]["IncidentPage"];
type ClassifierStatus = components["schemas"]["ClassifierStatus"];
type IncidentClassification = components["schemas"]["IncidentClassification"];
import { ActivityIcon, actorFromClassification, DEFAULT_ACTOR, type ActorPresentation } from "./activityPresentation";
const tabs = [
  { name: "Home", icon: House },
  { name: "Incidents", icon: History },
  { name: "Cameras", icon: Camera },
  { name: "Operations", icon: Activity },
  { name: "Settings", icon: Settings },
] as const;
type Tab = (typeof tabs)[number]["name"];
function time(value: string) {
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
function stamp(value: string) {
  return new Date(value).toLocaleString();
}
const EMPTY_PLACE = {
  id: "",
  name: "No place yet",
  revision_id: "",
  layout: {
    schema_version: "0.1",
    units: "meters",
    world_frame: "RH_Xright_Yforward_Zup",
    scale_status: "unknown",
    scale_anchors: [],
    floors: [{ id: "floor_0", name: "Ground floor", elevation_m: 0 }],
    rooms: [],
    zones: [],
    portals: [],
    cameras: [],
    asset_ids: [],
    floor_plan: null,
  },
  monitoring: { enabled: false, camera_ids: [], classification_enabled: false },
  monitoring_version: 0,
  evidence_mode: "replay",
  ring_status: "not_connected",
} as unknown as Site;

export default function App() {
  const [tab, setTab] = useState<Tab>("Home"),
    [site, setSite] = useState<Site | null>(null),
    [incidents, setIncidents] = useState<Incident[]>([]),
    [selected, setSelected] = useState<Incident | null>(null),
    [cameras, setCameras] = useState<CameraStatus[]>([]);
  const [ready, setReady] = useState(false),
    [paired, setPaired] = useState(!native),
    [error, setError] = useState(""),
    [online, setOnline] = useState(false),
    [lastSync, setLastSync] = useState(""),
    [busy, setBusy] = useState(false),
    [run, setRun] = useState<Run | null>(null),
    [view, setView] = useState("2D"),
    [room, setRoom] = useState(""),
    [placing, setPlacing] = useState(false),
    [sites, setSites] = useState<Site[]>([]),
    [activeSite, setActiveSite] = useState(""),
    [importing, setImporting] = useState(false),
    [confirmRemove, setConfirmRemove] = useState(""),
    [planImage, setPlanImage] = useState(""),
    [step, setStep] = useState(0),
    [testTrail, setTestTrail] = useState<Marker[]>([]);
  const [code, setCode] = useState(""),
    [hostedAccessCode, setHostedAccessCode] = useState(""),
    [pairCode, setPairCode] = useState(""),
    [pairExpiry, setPairExpiry] = useState(0),
    [sessions, setSessions] = useState<Session[]>([]),
    [nextCursor, setNextCursor] = useState<number | null>(null),
    [image, setImage] = useState(""),
    [imageError, setImageError] = useState(""),
    [classifierStatus, setClassifierStatus] = useState<ClassifierStatus | null>(null);
  const cursor = useRef(0),
    activeRef = useRef(""),
    current = useRef({ tab, selected }),
    runRef = useRef(run),
    testActorRef = useRef<ActorPresentation>(DEFAULT_ACTOR),
    refreshRef = useRef<() => Promise<void>>(async () => {});
  current.current = { tab, selected };
  const hostedWeb = !native && !localWeb;
  activeRef.current = activeSite;
  runRef.current = run;
  const handleError = useCallback((e: unknown) => {
    setError(e instanceof Error ? e.message : "Connection failed");
    if (e instanceof ApiError && e.status === 401) {
      setPaired(false);
      setSite(null);
      setSelected(null);
      setIncidents([]);
      setOnline(false);
      void clearToken();
    } else if (!(e instanceof ApiError)) {
      setOnline(false);
    }
  }, []);
  const refresh = useCallback(async () => {
    try {
      const all = await request<Site[]>("/v1/sites");
      setSites((previous) =>
        JSON.stringify(previous) === JSON.stringify(all) ? previous : all,
      );
      if (!all.length) {
        setSite(null);
        setActiveSite("");
        setIncidents([]);
        setCameras([]);
        setOnline(true);
        setLastSync(new Date().toISOString());
        setError("");
        return;
      }
      // The owner's last place is remembered server-side so a reload reopens it.
      let remembered = activeRef.current;
      if (!remembered)
        remembered =
          (await request<{ active_site_id: string | null }>("/v1/preferences"))
            .active_site_id ?? "";
      const active = all.find((s) => s.id === remembered) ?? all[0];
      setActiveSite(active.id);
      setSite((previous) =>
        JSON.stringify(previous) === JSON.stringify(active) ? previous : active,
      );
      const [page, cam] = await Promise.all([
        request<Page>(`/v1/sites/${active.id}/incidents`),
        request<CameraStatus[]>(`/v1/sites/${active.id}/cameras`),
      ]);
      setIncidents(page.incidents);
      setNextCursor(page.next_cursor ?? null);
      setCameras(cam);
      if (current.current.selected) {
        const item = await request<Incident>(
          `/v1/incidents/${current.current.selected.id}`,
        );
        setSelected((previous) => (previous?.id === item.id ? item : previous));
      }
      setOnline(true);
      setLastSync(new Date().toISOString());
      setError("");
    } catch (e) {
      handleError(e);
    }
  }, [handleError]);
  refreshRef.current = refresh;
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const hasSession = await initializePlatform();
        if (live) setPaired(hasSession);
        if (!native) {
          if (localWeb) await request("/v1/local-session", "POST");
          else await request<Session>("/v1/me");
        }
        else {
          const session = await request<Session>("/v1/me");
          if (session.expires_at < Date.now() / 1000 + 7 * 86400) {
            const renewed = await request<
              components["schemas"]["SessionToken"]
            >("/v1/sessions/renew", "POST");
            await storeToken(renewed.token);
          }
        }
        if (live) {
          setPaired(true);
          await refresh();
        }
      } catch (e) {
        if (live) handleError(e);
      } finally {
        if (live) setReady(true);
      }
    })();
    return () => {
      live = false;
    };
  }, [refresh, handleError]);
  useEffect(() => {
    let stop = () => {},
      ended = false;
    void lifecycle(
      () => void refreshRef.current(),
      () => {
        if (current.current.selected) {
          setSelected(null);
          return true;
        }
        if (current.current.tab !== "Home") {
          setTab("Home");
          return true;
        }
        return false;
      },
    ).then((fn) => {
      if (ended) fn();
      else stop = fn;
    });
    return () => {
      ended = true;
      stop();
    };
  }, []);
  useEffect(() => {
    if (!paired || !site?.id) return;
    let active = true,
      running = false;
    const poll = async () => {
      if (running || document.hidden) return;
      running = true;
      try {
        const page = await request<EventPage>(
          `/v1/sites/${site.id}/events?after=${cursor.current}`,
        );
        cursor.current = page.cursor;
        if (page.events.length || !online) await refreshRef.current();
        if (
          runRef.current &&
          ["queued", "running"].includes(runRef.current.state)
        ) {
          const result = await request<Run>(
            `/v1/sites/${site.id}/runs/${runRef.current.id}`,
          );
          if (active) {
            setRun(result);
            if (result.state === "succeeded") {
              await refreshRef.current();
              if (result.incident_id) {
                setSelected(
                  await request<Incident>(
                    `/v1/incidents/${result.incident_id}`,
                  ),
                );
                setStep(0);
              }
            }
          }
        }
        if (active && !page.events.length && online) {
          setOnline(true);
          setLastSync(new Date().toISOString());
        }
      } catch (e) {
        if (active) handleError(e);
      } finally {
        running = false;
      }
    };
    const timer = setInterval(() => void poll(), 2000);
    const visibility = () => {
      if (!document.hidden) void poll();
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("online", visibility);
    const offline = () => setOnline(false);
    window.addEventListener("offline", offline);
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("online", visibility);
      window.removeEventListener("offline", offline);
    };
  }, [paired, site?.id, online, handleError]);
  useEffect(() => {
    if (tab === "Settings" && paired)
      void Promise.all([
        request<Session[]>("/v1/sessions").then(setSessions),
        request<ClassifierStatus>("/v1/classifier").then(setClassifierStatus),
      ]).catch(handleError);
  }, [tab, paired, handleError]);
  const observation = selected?.observations[step];
  const evidenceId = selected?.evidence_ids.find(
    (id) => id === "evidence_" + observation?.observation_id,
  );
  useEffect(() => {
    let live = true,
      url = "";
    setImage("");
    setImageError("");
    if (evidenceId)
      void evidenceImage(evidenceId)
        .then((value) => {
          url = value;
          if (live) setImage(value);
          else URL.revokeObjectURL(value);
        })
        .catch(() => {
          if (live)
            setImageError(
              "Evidence unavailable. Reconnect and select the observation again.",
            );
        });
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [evidenceId]);
  const planAsset = site?.layout.floor_plan?.asset_id;
  useEffect(() => {
    let alive = true,
      url = "";
    setPlanImage("");
    if (site?.id && planAsset)
      void floorPlanImage(site.id)
        .then((value) => {
          url = value;
          if (alive) setPlanImage(value);
          else URL.revokeObjectURL(value);
        })
        .catch(() => {});
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [site?.id, planAsset]);
  const sampleLoaded = sites.some((s) => s.name === "Demo home");
  const rememberSite = (id: string) =>
    void request("/v1/preferences", "PUT", { active_site_id: id }).catch(
      () => {},
    );
  const switchSite = (id: string) => {
    if (id === activeSite) return;
    cursor.current = 0;
    setActiveSite(id);
    setSelected(null);
    setRoom("");
    setRun(null);
    setPlacing(false);
    const next = sites.find((s) => s.id === id);
    if (next) setSite(next);
    rememberSite(id);
  };
  const removeSite = (target: Site) =>
    void act(async () => {
      await request(`/v1/sites/${target.id}`, "DELETE");
      cursor.current = 0;
      setConfirmRemove("");
      if (target.id === activeSite) {
        setActiveSite("");
        setSite(null);
        setSelected(null);
        setRoom("");
        setRun(null);
      }
      await refresh();
    });
  const loadSample = () =>
    void act(async () => {
      const created = await request<Site>("/v1/sample-site", "POST");
      cursor.current = 0;
      setActiveSite(created.id);
      setSite(created);
      setTab("Home");
      await refresh();
    });
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(false);
    }
  };
  const replay = () =>
    void act(async () => {
      if (!site) return;
      const result = await request<Run>(`/v1/sites/${site.id}/replay`, "POST", {
        request_id: crypto.randomUUID(),
      });
      setRun(result);
    });
  const choose = (incident: Incident) => {
    setSelected(incident);
    setStep(0);
    setRoom("");
  };
  const updateMonitoring = (
    enabled: boolean,
    camera_ids = site?.monitoring.camera_ids ?? [],
    classification_enabled = site?.monitoring.classification_enabled ?? false,
  ) =>
    void act(async () => {
      if (site)
        setSite(
          await request<Site>(`/v1/sites/${site.id}/monitoring`, "PATCH", {
            enabled,
            camera_ids,
            classification_enabled,
          }),
        );
    });
  // Camera geometry lives in TwinForge: every edit publishes a new revision and
  // returns the site pinned to it. Incidents keep the revision they were recorded against.
  const editCameras = (fn: () => Promise<Site>) =>
    void act(async () => {
      setSite(await fn());
      await refresh();
    });
  const placeCamera = useCallback(
    (xy: [number, number]) => {
      setPlacing(false);
      if (!site) return;
      void act(async () => {
        const next = await request<Site>(
          `/v1/sites/${site.id}/cameras`,
          "POST",
          {
            name: `Camera ${site.layout.cameras.length + 1}`,
            position_m: [xy[0], xy[1], 2.2],
            heading_degrees: 270,
          },
        );
        setSite(next);
        setRoom(next.layout.cameras[next.layout.cameras.length - 1]?.id ?? "");
        await refresh();
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [site?.id, site?.layout.cameras.length],
  );
  const changeCamera = useCallback(
    (id: string, change: CameraChange) => {
      if (!site) return;
      editCameras(() =>
        request<Site>(`/v1/sites/${site.id}/cameras/${id}`, "PATCH", change),
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [site?.id],
  );
  const renameRoom = (id: string, name: string) => {
    if (!site) return;
    editCameras(() =>
      request<Site>(`/v1/sites/${site.id}/rooms/${id}`, "PATCH", { name }),
    );
  };
  const removeCamera = (id: string) => {
    if (!site) return;
    setRoom((current) => (current === id ? "" : current));
    editCameras(() =>
      request<Site>(`/v1/sites/${site.id}/cameras/${id}`, "DELETE"),
    );
  };
  const mapSelect = useCallback((id: string) => setRoom(id), []);
  const updateTestClassification = useCallback(
    (classification: IncidentClassification | null) => {
      const actor = actorFromClassification(classification);
      testActorRef.current = actor;
      setTestTrail((trail) => trail.map((point) => ({ ...point, ...actor })));
    },
    [],
  );
  const updateTestTrack = useCallback((track: TestTrack | null) => {
    if (!track) {
      setTestTrail([]);
      return;
    }
    if ("state" in track) {
      setTestTrail((trail) => trail.map((point) => ({ ...point, selected: false })));
      return;
    }
    setTestTrail((trail) => {
      const previous = trail[trail.length - 1];
      if (previous?.selected && Math.hypot(previous.xy[0] - track.xy[0], previous.xy[1] - track.xy[1]) < 0.22)
        return trail;
      const next = trail.map((point) => ({ ...point, selected: false }));
      next.push({
        id: `test-track-${trail.length}-${track.at.toFixed(2)}`,
        xy: track.xy,
        selected: true,
        approximate: true,
        gapBefore: !!previous && !previous.selected,
        headingDegrees: previous
          ? Math.atan2(track.xy[1] - previous.xy[1], track.xy[0] - previous.xy[0]) * 180 / Math.PI
          : 90,
        uncertainty_m: 0.55 + (1 - track.confidence) * 0.75,
        label: "Estimated movement from test video · no camera calibration",
        ...testActorRef.current,
      });
      return next;
    });
  }, []);
  const markers = useMemo<Marker[]>(() => {
    // An observation with no coordinate is a gap, not a position. Carry that
    // forward so the map can draw the unobserved leg instead of a clean line.
    let unobserved = false;
    const incidentMarkers = (
      selected?.observations.flatMap((o, i) => {
        if (o.location.kind !== "floor_point") {
          unobserved = true;
          return [];
        }
        const marker: Marker = {
          id: o.observation_id,
          xy: o.location.xy_m as [number, number],
          selected: i === step,
          gapBefore: unobserved,
        };
        unobserved = false;
        return [marker];
      }) ?? []
    );
    return selected ? incidentMarkers : testTrail;
  }, [selected, selected?.observations, step, testTrail]);
  const nav = (name: Tab) => {
    setTab(name);
    if (name !== "Home" && view === "Camera wall") setView("2D");
    setSelected(null);
    setRoom((current) =>
      (name === "Home" || name === "Cameras") &&
      site?.layout.cameras.some((camera) => camera.id === current)
        ? current
        : "",
    );
  };
  const running = !!run && ["queued", "running"].includes(run.state);

  if (!ready)
    return (
      <main className="welcome">
        <Shield size={36} />
        <h1>SpatialGuard</h1>
        <p>Opening your workspace…</p>
      </main>
    );
  if (!paired)
    return (
      <main className="welcome">
        <Shield size={36} />
        <h1>SpatialGuard</h1>
        <p>
          {native && !paired
            ? "Pair with your local workspace"
            : hostedWeb
              ? "Sign in to the hosted workspace"
              : "Local workspace unavailable"}
        </p>
        <p>
          {hostedWeb ? "Enter the access code configured for this hosted preview." : "Start SpatialGuard on your PC."}
          {native && !paired
            ? " Connect this Android device by USB, then get a pairing code from Settings in the web app."
            : ""}
        </p>
        {error && <p role="alert">{error}</p>}
        {native && !paired ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void act(async () => {
                const result = await request<
                  components["schemas"]["SessionToken"]
                >("/v1/pairing/redeem", "POST", {
                  code: code.trim(),
                  name: "Android preview",
                });
                await storeToken(result.token);
                setPaired(true);
                await refresh();
              });
            }}
          >
            <label htmlFor="pair-code">Pairing code</label>
            <input
              id="pair-code"
              autoCapitalize="characters"
              autoComplete="off"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              maxLength={12}
            />
            <button
              className="primary"
              disabled={busy || code.trim().length !== 12}
            >
              Pair device
            </button>
          </form>
        ) : hostedWeb ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void act(async () => {
                await request<Session>("/v1/hosted-session", "POST", {
                  access_code: hostedAccessCode,
                });
                setHostedAccessCode("");
                setPaired(true);
                await refresh();
              });
            }}
          >
            <label htmlFor="hosted-access-code">Access code</label>
            <input
              id="hosted-access-code"
              type="password"
              autoComplete="current-password"
              value={hostedAccessCode}
              onChange={(e) => setHostedAccessCode(e.target.value)}
              minLength={12}
              maxLength={128}
              required
            />
            <button className="primary" disabled={busy || hostedAccessCode.length < 12}>
              Sign in
            </button>
          </form>
        ) : (
          <button
            onClick={() =>
              void act(async () => {
                if (!native && localWeb) await request("/v1/local-session", "POST");
                setPaired(true);
                await refresh();
              })
            }
          >
            Reconnect
          </button>
        )}
      </main>
    );

  // The workspace can have no place yet. The shell still renders; only the map
  // card is empty, so the rest of the app stays where the owner expects it.
  const place: Site = site ?? EMPTY_PLACE;
  const editable = !selected && online && !busy;
  const activeCamera = place.layout.cameras.find((c) => c.id === room);
  const activeRoom = place.layout.rooms.find((r) => r.id === room);
  const map = (
    <section className="map-panel" aria-label="Home map">
      <div className="panel-heading">
        <h2>{view === "Camera wall" ? "Camera wall" : "Ground floor"}</h2>
        {site && (
          <div className="map-tools">
            {view === "2D" && (
              <button
                className={placing ? "primary" : undefined}
                aria-pressed={placing}
                disabled={!editable || place.layout.cameras.length >= 8}
                onClick={() => setPlacing((on) => !on)}
              >
                {placing ? <X size={16} /> : <Plus size={16} />}
                {placing ? "Cancel" : "Add camera"}
              </button>
            )}
            <div className="view-toggle" aria-label="Map view">
              {(tab === "Home" && !selected ? ["2D", "3D", "Camera wall"] : ["2D", "3D"]).map((v) => (
                <button
                  key={v}
                  aria-pressed={view === v}
                  onClick={() => {
                    setView(v);
                    setPlacing(false);
                  }}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      {!site && (
        <div className="map-empty">
          <Map size={30} />
          <h3>No floor plan yet</h3>
          <p>
            Upload a drawing of your ground floor to see your Ring cameras on a
            real map of your home, and where their coverage stops.
          </p>
          <div className="button-row">
            <button
              className="primary"
              disabled={busy}
              onClick={() => setImporting(true)}
            >
              <Map size={16} />
              Upload floor plan
            </button>
            <button disabled={busy} onClick={loadSample}>
              <Play size={16} />
              Load sample
            </button>
          </div>
          <small>
            The sample is a synthetic demo home with two cameras and replay
            activity — nothing from your own home.
          </small>
        </div>
      )}
      {site && (
        <div className={`map-area map-area-${view.toLowerCase().replace(" ", "-")}`}>
          {view === "2D" ? (
            <Map2D
              layout={place.layout as Layout}
              selected={room}
              onSelect={mapSelect}
              markers={markers}
              fitBuilding={tab === "Home"}
              editable={editable}
              placing={placing}
              background={planImage}
              onCameraChange={changeCamera}
              onPlace={placeCamera}
            />
          ) : view === "3D" ? (
            <Suspense fallback={<p>Loading 3D…</p>}>
              <Scene3D
                siteId={place.id}
                layout={place.layout as Layout}
                selected={room}
                onSelect={mapSelect}
                markers={markers}
              />
            </Suspense>
          ) : <CameraWall compact />}
        </div>
      )}
      {activeRoom && view === "2D" && (
        <div className="map-camera-panel">
          <div className="panel-heading">
            <h3>
              <RenameField
                value={activeRoom.name}
                label="Space name"
                disabled={!editable}
                onRename={(name) => renameRoom(activeRoom.id, name)}
              />
            </h3>
            <span>
              {activeRoom.provenance.confirmed ? "Reviewed" : "Needs review"}
            </span>
          </div>
          <p className="camera-lens">
            {activeRoom.provenance.kind === "inferred"
              ? "Traced from your drawing — rename it to match the real room."
              : "Part of the synthetic demo fixture."}
          </p>
        </div>
      )}
      {activeCamera && view === "2D" && tab !== "Home" && (
        <div className="map-camera-panel">
          <div className="panel-heading">
            <h3>
              <RenameField
                value={activeCamera.name}
                label="Camera name"
                disabled={!editable}
                onRename={(name) => changeCamera(activeCamera.id, { name })}
              />
            </h3>
            <span>
              {place.monitoring.camera_ids.includes(activeCamera.id)
                ? "In replay"
                : "Not in replay"}
            </span>
          </div>
          <CameraControls
            camera={activeCamera as PlacedCamera}
            disabled={!editable}
            onChange={(change) => changeCamera(activeCamera.id, change)}
            onRemove={() => removeCamera(activeCamera.id)}
          />
        </div>
      )}
      {site && (
        <div className="map-caption">
          <span>
            <MapPin size={14} />
            {placing
              ? "Click the plan to place a camera"
              : (place.layout.rooms.find((r) => r.id === room)?.name ??
                activeCamera?.name ??
                "Select a room or camera")}
          </span>
          <span>
            {view === "Camera wall"
              ? "Live Ring views ? saved camera order"
              : view === "3D"
                ? "Illustrative walls · drag to orbit"
              : editable
                ? "Drag a camera to move it · drag its handle to aim"
                : "Synthetic coordinates · gaps stay unknown"}
          </span>
        </div>
      )}
    </section>
  );
  const list = (
    <section className="incident-list">
      <div className="panel-heading">
        <h2>{tab === "Home" ? "Recent incidents" : "Incident history"}</h2>
        <span>{incidents.length} shown</span>
      </div>
      <div className="incident-scroll">
        {incidents.length === 0 ? (
          <div className="empty">
            <History size={28} />
            <h3>No incidents yet</h3>
            <p>
              {site
                ? "Run the synthetic replay to follow activity from the front approach into the hallway."
                : "Add a floor plan to start. Incidents are recorded against a place."}
            </p>
            <button
              onClick={replay}
              disabled={
                !site || busy || running || !online || !place.monitoring.enabled
              }
            >
              Run replay
            </button>
          </div>
        ) : (
          incidents.map((incident) => (
            <button
              className="incident-row"
              key={incident.id}
              onClick={() => choose(incident)}
            >
              <span className="incident-symbol">
                {incident.classification ? <ActivityIcon classification={incident.classification} /> : <MapPin size={20} />}
              </span>
              <span>
                <strong>{incident.title}</strong>
                <small>
                  {stamp(incident.created_at)} ?{" "}
                  {incident.evidence_mode === "live"
                    ? "Live integration"
                    : incident.evidence_mode === "simulator"
                      ? "Official simulator"
                      : "Replay"}
                </small>
                <small>
                  {incident.status === "reviewed" ? "Reviewed" : "Needs review"} ?{" "}
                  {
                    incident.observations.filter(
                      (observation) => observation.location.kind !== "unknown",
                    ).length
                  }{" "}
                  observations
                </small>
              </span>
              <ArrowUpRight size={18} />
            </button>
          ))
        )}
        {nextCursor && (
          <button
            onClick={() =>
              void act(async () => {
                const page = await request<Page>(
                  `/v1/sites/${place.id}/incidents?before=${nextCursor}`,
                );
                setIncidents((all) => [...all, ...page.incidents]);
                setNextCursor(page.next_cursor ?? null);
              })
            }
          >
            Load older incidents
          </button>
        )}
      </div>
    </section>
  );
  const detail = selected && (
    <section className="detail">
      <div className="panel-heading">
        <button className="text-button" onClick={() => setSelected(null)}>
          <ArrowLeft size={18} />
          All incidents
        </button>
        <span className="mode">
          {selected.evidence_mode === "live"
            ? "Live integration"
            : selected.evidence_mode === "simulator"
              ? "Official simulator"
              : "Replay"}
        </span>
      </div>
      <h2>{selected.title}</h2>
      <p className="muted">{selected.rule}</p>
      {selected.classification ? (
        <section className="classification-card" aria-label="AI snapshot classification">
          <div>
            <ActivityIcon classification={selected.classification} />
            <span className="eyebrow">Luna snapshot classification</span>
            <strong>{selected.classification.display_label}</strong>
          </div>
          <span className={`confidence confidence-${selected.classification.confidence}`}>
            {selected.classification.confidence} confidence
          </span>
          <p>{selected.classification.summary}</p>
          {selected.classification.visible_evidence.length > 0 && (
            <ul>
              {selected.classification.visible_evidence.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
          <small>
            Uncertainty: {selected.classification.uncertainty} · AI interpretation,
            review required. No identity or gender inference.
          </small>
        </section>
      ) : selected.evidence_mode === "live" ? (
        <section className="classification-card classification-empty">
          <div>
            <span className="eyebrow">Luna snapshot classification</span>
            <strong>
              {selected.classification_status === "unavailable"
                ? "Classification unavailable"
                : "Not analyzed"}
            </strong>
          </div>
          <p>
            Analyze the latest authorized camera snapshot. The image is sent to
            OpenAI for this request and is not stored by SpatialGuard.
          </p>
          <button
            disabled={busy || !online}
            onClick={() =>
              void act(async () => {
                const result = await request<Incident>(
                  `/v1/incidents/${selected.id}/classify`,
                  "POST",
                );
                setSelected(result);
                await refresh();
              })
            }
          >
            Analyze snapshot with Luna
          </button>
        </section>
      ) : null}
      <div className="evidence-view">
        {image ? (
          <img
            src={image}
            alt="Synthetic replay illustration of a person, not camera footage"
          />
        ) : (
          <p>
            {selected.evidence_mode === "live"
              ? selected.classification
                ? "The Ring snapshot was analyzed for this classification and was not stored. Activity position remains unknown."
                : "Ring event metadata. Recorded footage is unavailable; activity position is unknown."
              : observation?.location.kind === "unknown"
                ? "Unknown location — no footage or coordinate evidence for this gap."
                : imageError || "Loading evidence…"}
          </p>
        )}
      </div>
      <div className="evidence-caption">
        <strong>
          {observation?.location.kind === "unknown"
            ? "Unknown"
            : place.layout.cameras.find((c) => c.id === observation?.source_id)
                ?.name}
        </strong>
        <span>
          {observation && time(observation.observed_at)} ·{" "}
          {selected.evidence_mode === "live"
            ? "Ring event time"
            : "synthetic fixture time"}
        </span>
      </div>
      <ol className="timeline">
        {selected.observations.map((o, i) => {
          const association = selected.associations.find(
            (a) => a.to_observation_id === o.observation_id,
          );
          return (
            <li key={o.observation_id}>
              {association && (
                <div className="handoff">
                  <Link2 size={14} />
                  <span>
                    Possible continuation · {association.unobserved_gap_seconds}
                    s unobserved
                    <br />
                    <small>{association.reason}</small>
                  </span>
                </div>
              )}
              <button aria-pressed={step === i} onClick={() => setStep(i)}>
                <time>{time(o.observed_at)}</time>
                <span>
                  {o.location.kind === "unknown"
                    ? selected.evidence_mode === "live"
                      ? `Observed ${o.category} · position unknown`
                      : "Unknown · coverage gap"
                    : `Observed · ${place.layout.cameras.find((c) => c.id === o.source_id)?.name ?? o.source_id}`}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <div className="review-footer">
        <span>
          Pinned revision {selected.revision_id.slice(-6)}
          <br />
          Calibration:{" "}
          {selected.evidence_mode === "live"
            ? "not available; position unknown"
            : "synthetic positions"}
        </span>
        <button
          className="primary"
          disabled={selected.status === "reviewed" || busy || !online}
          onClick={() =>
            void act(async () => {
              setSelected(
                await request<Incident>(
                  `/v1/incidents/${selected.id}/review`,
                  "POST",
                  { status: "reviewed" },
                ),
              );
              await refresh();
            })
          }
        >
          <Check size={16} />
          {selected.status === "reviewed" ? "Reviewed" : "Mark reviewed"}
        </button>
      </div>
    </section>
  );

  return (
    <div className="app-shell">
      {importing && (
        <PlanImporter
          onClose={() => setImporting(false)}
          onLoadSample={() => {
            setImporting(false);
            loadSample();
          }}
          onAccepted={(created) => {
            setImporting(false);
            cursor.current = 0;
            setActiveSite(created.id);
            rememberSite(created.id);
            setSite(created as Site);
            setSelected(null);
            setRoom("");
            setTab("Home");
            void refresh();
          }}
        />
      )}
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            nav("Home");
          }}
        >
          <Shield size={28} />
          <span>SpatialGuard</span>
        </a>
        <nav aria-label="Main navigation">
          {tabs.map(({ name, icon: Icon }) => (
            <button
              key={name}
              aria-current={tab === name ? "page" : undefined}
              onClick={() => nav(name)}
            >
              <Icon size={20} />
              <span>{name}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span>Local preview</span>
          <small>Ring connection in Settings</small>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div>
            {sites.length > 1 ? (
              <select
                className="site-name"
                aria-label="Place"
                value={activeSite}
                onChange={(e) => switchSite(e.target.value)}
              >
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            ) : (
              <span className="site-name">{place.name}</span>
            )}
            <h1>{tab}</h1>
          </div>
          <div className="top-actions">
            <span className="mode">Local preview</span>
            <button
              title="Map from a floor plan"
              onClick={() => setImporting(true)}
            >
              <Map size={17} />
              <span className="wide-only">Floor plan</span>
            </button>
            <button
              title="Refresh workspace"
              aria-label="Refresh workspace"
              onClick={() => void refresh()}
            >
              <RefreshCw size={17} />
            </button>
          </div>
        </header>
        <div className="connection" role="status">
          {online
            ? `Workspace connected · checked ${time(lastSync)}`
            : `Disconnected · ${lastSync ? "last checked " + time(lastSync) : "reconnect to update"}`}
        </div>
        {error && (
          <div className="notice error" role="alert">
            {error}
            <button onClick={() => void refresh()}>Retry</button>
          </div>
        )}
        <main className="content">
          {(tab === "Home" || tab === "Incidents") && (
            <>
              {site && (
                <div className="monitor-bar">
                  <div>
                    <strong>
                      {place.monitoring.enabled
                        ? "Monitoring enabled"
                        : "Monitoring paused"}
                    </strong>
                    <span>
                      {place.monitoring.camera_ids.length} selected cameras ·{" "}
                      {place.monitoring.classification_enabled
                        ? "Luna snapshot classification enabled"
                        : cameras.some((c) => c.state === "live_connected")
                        ? "Ring events enabled for mapped cameras"
                        : "Ring cameras not mapped"}
                    </span>
                  </div>
                  <div className="button-row">
                    <button
                      onClick={() =>
                        updateMonitoring(!place.monitoring.enabled)
                      }
                      disabled={busy || !online}
                    >
                      {place.monitoring.enabled ? (
                        <Pause size={16} />
                      ) : (
                        <Play size={16} />
                      )}
                      <span>
                        {place.monitoring.enabled ? "Pause" : "Enable"}
                      </span>
                    </button>
                    <button
                      className="primary"
                      onClick={replay}
                      disabled={
                        busy ||
                        running ||
                        !online ||
                        !place.monitoring.enabled ||
                        !place.monitoring.camera_ids.length
                      }
                    >
                      <Play size={16} />
                      {running ? "Processing…" : "Run replay"}
                    </button>
                  </div>
                </div>
              )}
              {run && (
                <p className="run-status" role="status">
                  {run.state === "succeeded"
                    ? "Replay complete. Evidence is synthetic."
                    : run.state === "paused"
                      ? "Replay stopped because monitoring changed."
                      : run.state === "failed"
                        ? run.error
                        : "Replay is being processed by the backend."}
                </p>
              )}
              {selected ? (
                <div className="review-layout">
                  {map}
                  {detail}
                </div>
              ) : tab === "Home" ? (
                <div className="home-dashboard">
                  {map}
                  <aside
                    className={`home-side-rail${activeCamera ? " camera-selected" : ""}`}
                    aria-label="Home activity"
                  >
                    <HomeCctv
                      siteId={site?.id}
                      cameras={cameras}
                      selected={activeCamera as PlacedCamera | undefined}
                      onSelect={(cameraId) => {
                        setRoom(cameraId);
                        setSelected(null);
                      }}
                      onClear={() => setRoom("")}
                      onViewAll={() => nav("Cameras")}
                      classificationEnabled={place.monitoring.classification_enabled}
                      onTestTrack={updateTestTrack}
                      onTestClassification={updateTestClassification}
                    />
                    {list}
                  </aside>
                </div>
              ) : (
                <div className="incident-page">{list}</div>
              )}
            </>
          )}
          {tab === "Cameras" && (
            <CameraWorkspace
              site={site}
              initialCameraId={room}
              cameras={cameras}
              incidents={incidents}
              busy={busy}
              online={online}
              onAdd={() => {
                const [bx, by, bw, bh] = bounds(place.layout as Layout);
                placeCamera([
                  Math.round((bx + bw / 2) * 20) / 20,
                  Math.round((by + bh / 2) * 20) / 20,
                ]);
              }}
              onToggle={(cameraId, checked) =>
                updateMonitoring(
                  place.monitoring.enabled,
                  checked
                    ? [...place.monitoring.camera_ids, cameraId]
                    : place.monitoring.camera_ids.filter((id) => id !== cameraId),
                )
              }
              onSelectCamera={setRoom}
              onIncident={(incident) => {
                choose(incident);
                setTab("Incidents");
              }}
            />
          )}
          {tab === "Operations" && <Operations />}
          {tab === "Settings" && (
            <div className="settings-page">
              <section>
                <h2>Places</h2>
                <p>
                  {sites.length
                    ? "Removing a place deletes its map, its floor-plan drawing, and every incident recorded against it, here and in TwinForge. This cannot be undone."
                    : "No places yet. Trace your own floor plan, or load the demo home to try the app out."}
                </p>
                {sites.map((s) => (
                  <div className="session-row" key={s.id}>
                    <span>
                      {s.name}
                      <small>
                        {s.layout.rooms.length} spaces ·{" "}
                        {s.layout.cameras.length} cameras
                        {s.layout.floor_plan ? " · traced from a drawing" : ""}
                      </small>
                    </span>
                    {confirmRemove === s.id ? (
                      <span className="button-row">
                        <button onClick={() => setConfirmRemove("")}>
                          Cancel
                        </button>
                        <button
                          className="danger"
                          disabled={busy || !online}
                          onClick={() => removeSite(s)}
                        >
                          Remove for good
                        </button>
                      </span>
                    ) : (
                      <button
                        disabled={busy || !online}
                        onClick={() => setConfirmRemove(s.id)}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}
                <div className="button-row">
                  <button onClick={() => setImporting(true)}>
                    <Map size={16} />
                    Add a place from a floor plan
                  </button>
                  <button disabled={busy || !online} onClick={loadSample}>
                    <Play size={16} />
                    {sampleLoaded ? "Switch to demo home" : "Load demo home"}
                  </button>
                </div>
                <p className="fine">
                  The demo home is a synthetic fixture for trying the app out:
                  five spaces, two cameras, and replay activity. Nothing in it
                  comes from your home.
                </p>
              </section>
              <section>
                <h2>Luna incident classification</h2>
                <p>
                  When enabled, a Ring motion or doorbell event sends one authorized
                  camera snapshot to OpenAI GPT-5.6 Luna. SpatialGuard stores the
                  classification and visible evidence, but not the snapshot. It does
                  not identify people or infer gender.
                </p>
                <p className="fine">
                  Security-sensitive results use cautious labels such as “Possible
                  weapon visible” and always require review. API usage is billed to
                  the configured OpenAI account.
                </p>
                <button
                  disabled={!site || busy || !online || !classifierStatus?.configured}
                  aria-pressed={site?.monitoring.classification_enabled ?? false}
                  onClick={() =>
                    site &&
                    updateMonitoring(
                      site.monitoring.enabled,
                      site.monitoring.camera_ids,
                      !site.monitoring.classification_enabled,
                    )
                  }
                >
                  {site?.monitoring.classification_enabled
                    ? "Disable Luna classification"
                    : "Enable Luna classification"}
                </button>
                <p className="fine" role="status">
                  {classifierStatus?.configured
                    ? `${classifierStatus.model} is configured on this server.`
                    : "Add OPENAI_API_KEY to the root .env and restart SpatialGuard."}
                </p>
              </section>
              <RingConnection sites={sites} />
              <section>
                <h2>Android pairing</h2>
                {native ? (
                  <p>This device is paired to your local workspace.</p>
                ) : (
                  <>
                    <p>
                      Connect the phone by USB with ADB reverse enabled. Codes
                      expire after three minutes and work once.
                    </p>
                    <button
                      onClick={() =>
                        void act(async () => {
                          const value = await request<
                            components["schemas"]["PairCode"]
                          >("/v1/pairing", "POST");
                          setPairCode(value.code);
                          setPairExpiry(value.expires_at);
                        })
                      }
                    >
                      Create pairing code
                    </button>
                    {pairCode && (
                      <div className="pair-code">
                        <output aria-label="Pairing code">{pairCode}</output>
                        <small>
                          Expires{" "}
                          {time(new Date(pairExpiry * 1000).toISOString())}
                        </small>
                      </div>
                    )}
                  </>
                )}
              </section>
              <section>
                <h2>Connected sessions</h2>
                {sessions.map((s) => (
                  <div className="session-row" key={s.id}>
                    <span>
                      {s.name}
                      <small>
                        {s.kind} · expires{" "}
                        {stamp(new Date(s.expires_at * 1000).toISOString())}
                      </small>
                    </span>
                    <button
                      onClick={() =>
                        void act(async () => {
                          await request(`/v1/sessions/${s.id}`, "DELETE");
                          setSessions(await request<Session[]>("/v1/sessions"));
                        })
                      }
                    >
                      Revoke
                    </button>
                  </div>
                ))}
              </section>
              <section>
                <h2>Data and evidence</h2>
                <p>
                  This preview contains synthetic observations and
                  illustrations, stored locally on your PC. Audio, recording,
                  remote notifications, and caregiver access are disabled.
                </p>
                <p>
                  Geometry revision:{" "}
                  <code>{place.revision_id || "no place selected"}</code>
                </p>
                <p>Application version 0.1 · TwinForge schema 0.1</p>
              </section>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

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
  Settings,
  Activity,
  Play,
  ArrowLeft,
  ArrowUpRight,
  Pause,
  RefreshCw,
  MapPin,
  Link2,
  Plus,
  X,
  Map,
  LogOut,
  ChevronRight,
  Trash2,
} from "lucide-react";
import Map2D from "@twinforge/spatial-view/Map2D";
import MapControls from "./MapControls";
import { HeatmapLegend, HeatmapPanel, usePeopleHeatmap, type HeatRange } from "./PeopleHeatmap";
import type { EvidenceLink, Marker } from "@twinforge/spatial-view/Map2D";
import type { CameraChange } from "@twinforge/spatial-view/cameraGlyph";
import CameraControls from "./CameraControls";
import RenameField from "./RenameField";
import PlanImporter from "./PlanImporter";
import PairCameraSheet from "./PairCameraSheet";
import CameraMark from "./CameraMark";
import RingConnection from "./RingConnection";
import CameraWorkspace from "./CameraWorkspace";
import CameraWall from "./CameraWall";
import HomeCctv from "./HomeCctv";
import IncidentReview from "./IncidentReview";
import Operations from "./Operations";
import Onboarding, { type AccountPreferences } from "./Onboarding";
import AccountSecurity from "./AccountSecurity";
import { useDialogFocus } from "./useDialogFocus";
import RecoveryNotice from "./RecoveryNotice";
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
type IncidentClassification = components["schemas"]["IncidentClassification"];
type ProductCapabilities = components["schemas"]["ProductCapabilities"];
import { ActivityIcon, actorFromClassification, DEFAULT_ACTOR, type ActorPresentation } from "./activityPresentation";
const tabs = [
  { name: "Home", icon: House },
  { name: "Incidents", icon: History },
  { name: "Cameras", icon: CameraMark },
  { name: "Operations", icon: Activity },
  { name: "Settings", icon: Settings },
] as const;
type Tab = (typeof tabs)[number]["name"];
type SettingsPage = "menu" | "account" | "places" | "privacy" | "ring" | "devices" | "display" | "security" | "delete";
const settingsLabels: Record<SettingsPage, string> = {
  menu: "Settings", account: "Account", places: "Places & floor plans",
  privacy: "Privacy & retention", ring: "Ring cameras", devices: "Connected devices",
  display: "Display & performance", security: "Security & data", delete: "Delete account",
};
function time(value: string) {
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
function stamp(value: string) {
  return new Date(value).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
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
  const returnedFromRing = new URLSearchParams(window.location.search).get("ring") === "connected";
  const [tab, setTab] = useState<Tab>("Home"),
    [site, setSite] = useState<Site | null>(null),
    [incidents, setIncidents] = useState<Incident[]>([]),
    [selected, setSelected] = useState<Incident | null>(null),
    [cameras, setCameras] = useState<CameraStatus[]>([]);
  const [ringSetupOpen, setRingSetupOpen] = useState(returnedFromRing);
  const [settingsPage, setSettingsPage] = useState<SettingsPage>("menu");
  const [ready, setReady] = useState(false),
    [paired, setPaired] = useState(!native),
    [error, setError] = useState(""),
    [online, setOnline] = useState(false),
    [lastSync, setLastSync] = useState(""),
    [busy, setBusy] = useState(false),
    [run, setRun] = useState<Run | null>(null),
    [view, setView] = useState("2D"),
    [mapZoom, setMapZoom] = useState(1),
    [mapViewKey, setMapViewKey] = useState(0),
    [motionMode, setMotionMode] = useState(false),
    [heatmapOn, setHeatmapOn] = useState(false),
    [heatRange, setHeatRange] = useState<HeatRange>({ preset: "24h" }),
    [lowPower, setLowPower] = useState(() => {
      const saved = window.localStorage.getItem("spatialguard-low-power");
      if (saved !== null) return saved === "true";
      const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches || Boolean(connection?.saveData);
    }),
    [room, setRoom] = useState(""),
    [placing, setPlacing] = useState(false),
    [sites, setSites] = useState<Site[]>([]),
    [activeSite, setActiveSite] = useState(""),
    [importing, setImporting] = useState(false),
    [confirmRemove, setConfirmRemove] = useState(""),
    [planImage, setPlanImage] = useState(""),
    [step, setStep] = useState(0),
    [testTrail, setTestTrail] = useState<Marker[]>([]),
    [incidentTrail, setIncidentTrail] = useState<Marker[]>([]),
    [testPackage, setTestPackage] = useState<Marker | null>(null);
  const [pairCode, setPairCode] = useState(""),
    [pairExpiry, setPairExpiry] = useState(0),
    [sessions, setSessions] = useState<Session[]>([]),
    [currentSession, setCurrentSession] = useState<Session | null>(null),
    [nextCursor, setNextCursor] = useState<number | null>(null),
    [image, setImage] = useState(""),
    [imageError, setImageError] = useState(""),
    [accountPreferences, setAccountPreferences] = useState<AccountPreferences | null>(null),
    [pairTarget, setPairTarget] = useState<{ id: string; name: string } | null>(null),
    [ringVersion, setRingVersion] = useState(0),
    [onboardingOpen, setOnboardingOpen] = useState(false),
    [deleteOpen, setDeleteOpen] = useState(false),
    [deletePassword, setDeletePassword] = useState(""),
    [deleteConfirmation, setDeleteConfirmation] = useState(""),
    [deleteError, setDeleteError] = useState("");
  const [features, setFeatures] = useState<ProductCapabilities>({ profile: "preview", classification: true, timelapse: true, uptime_history: true, offline_alerts: true, test_video: true, synthetic_replay: true, reviewer_diagnostics: false });
  const deleteDialog = useDialogFocus(deleteOpen, () => setDeleteOpen(false));
  const cursor = useRef(0),
    activeRef = useRef(""),
    current = useRef({ tab, selected, settingsPage, ringSetupOpen }),
    runRef = useRef(run),
    testActorRef = useRef<ActorPresentation>(DEFAULT_ACTOR),
    refreshRef = useRef<() => Promise<void>>(async () => {});
  current.current = { tab, selected, settingsPage, ringSetupOpen };
  const hostedWeb = !native && !localWeb;
  const environmentLabel = hostedWeb ? "Cloud workspace" : "Local workspace";
  activeRef.current = activeSite;
  runRef.current = run;
  useEffect(() => {
    const reset = () => window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    reset();
    const frame = window.requestAnimationFrame(reset);
    const timer = window.setTimeout(reset, 0);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [tab]);
  useEffect(() => {
    window.localStorage.setItem("spatialguard-low-power", String(lowPower));
    if (lowPower && view === "3D") setView("2D");
  }, [lowPower, view]);
  const handleError = useCallback((e: unknown) => {
    setError(e instanceof Error ? e.message : "Connection failed");
    if (e instanceof ApiError && e.status === 401) {
      setPaired(false);
      setSite(null);
      setSelected(null);
      setIncidents([]);
      setOnline(false);
      void clearToken();
      setCurrentSession(null);
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
          const session = localWeb
            ? await request<Session>("/v1/local-session", "POST")
            : await request<Session>("/v1/me");
          if (live) setCurrentSession(session);
        }
        else {
          const session = await request<Session>("/v1/me");
          if (live) setCurrentSession(session);
          if (session.expires_at < Date.now() / 1000 + 7 * 86400) {
            const renewed = await request<
              components["schemas"]["SessionToken"]
            >("/v1/sessions/renew", "POST");
            await storeToken(renewed.token);
          }
        }
        const preferences = await request<AccountPreferences>("/v1/account/preferences");
        const releaseFeatures = await request<ProductCapabilities>("/v1/product-capabilities");
        if (live) setFeatures(releaseFeatures);
        if (live) {
          setAccountPreferences(preferences);
          setOnboardingOpen(!preferences.onboarding_completed && (native || !localWeb));
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
        if (current.current.ringSetupOpen) {
          setRingSetupOpen(false);
          return true;
        }
        if (current.current.tab === "Settings" && current.current.settingsPage !== "menu") {
          setSettingsPage("menu");
          return true;
        }
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
        request<AccountPreferences>("/v1/account/preferences").then(setAccountPreferences),
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
              "Evidence unavailable. Reconnect and try again.",
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
  // Hooks must run before the early returns below.
  const heat = usePeopleHeatmap(site?.id, heatmapOn && !selected, heatRange, incidents[0]?.id);
  const rememberSite = (id: string) =>
    void request("/v1/preferences", "PUT", { active_site_id: id }).catch(
      () => {},
    );
  const saveAccountPreferences = async (next: AccountPreferences) => {
    const saved = await request<AccountPreferences>("/v1/account/preferences", "PATCH", next);
    setAccountPreferences(saved);
    if (saved.onboarding_completed) setOnboardingOpen(false);
  };
  const deleteAccount = async () => {
    setBusy(true);
    setDeleteError("");
    try {
      const receipt = await request<{ reference: string }>("/v1/account", "DELETE", {
        password: deletePassword,
        confirmation: deleteConfirmation,
      });
      sessionStorage.setItem("spatialguard_deletion_receipt", receipt.reference);
      await clearToken();
      window.location.assign(native ? "/" : "/landing");
    } catch (problem) {
      setDeleteError(problem instanceof Error ? problem.message : "Could not delete the account");
      setBusy(false);
    }
  };
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
  const deleteIncident = (incident: Incident, event: React.MouseEvent) => {
    event.stopPropagation();
    const label = incident.title || "this incident";
    if (!window.confirm(`Delete ${label}? This removes the incident and its evidence.`)) return;
    void act(async () => {
      await request<void>(`/v1/incidents/${encodeURIComponent(incident.id)}`, "DELETE");
      setIncidents((all) => all.filter((item) => item.id !== incident.id));
      if (selected?.id === incident.id) {
        setSelected(null);
        setIncidentTrail([]);
        setTestTrail([]);
        setTestPackage(null);
      }
    });
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
  const confirmRemoveCamera = (camera: { id: string; name: string }) => {
    if (!window.confirm(`Remove ${camera.name}? It will be taken off your map and unpaired from Ring.`)) return;
    removeCamera(camera.id);
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
      setTestPackage(null);
      return;
    }
    if ("state" in track) {
      if (track.state === "clear-package") {
        setTestPackage(null);
        return;
      }
      setTestTrail((trail) => trail.map((point) => ({ ...point, selected: false })));
      return;
    }
    if (track.entity === "package") {
      setTestPackage({
        id: "test-package-drop",
        xy: track.xy,
        selected: false,
        persistent: true,
        approximate: true,
        gapBefore: true,
        uncertainty_m: 0.7,
        actorKind: "package",
        actorLabel: "Package dropped",
        reviewLevel: "routine",
        label: "Estimated package drop point from test video",
      });
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
        ...(track.actorKind ? {
          actorKind: track.actorKind,
          actorLabel: track.actorLabel,
          reviewLevel: track.reviewLevel,
        } : {}),
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
        if (o.location.kind === "unknown" && selected.evidence_mode === "live") {
          const camera = site?.layout.cameras.find((item) => item.id === o.source_id);
          if (!camera) return [];
          return [{
            id: o.observation_id,
            xy: [camera.position_m[0], camera.position_m[1]] as [number, number],
            selected: i === step,
            evidenceNode: true,
            label: `Activity observed by ${camera.name}; person position unknown`,
          } satisfies Marker];
        }
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
    return selected ? [...incidentMarkers, ...incidentTrail] : testPackage ? [...testTrail, testPackage] : testTrail;
  }, [selected, selected?.observations, site?.layout.cameras, step, testTrail, testPackage, incidentTrail]);
  const evidenceLinks = useMemo<EvidenceLink[]>(() => {
    if (!selected || selected.evidence_mode !== "live") return [];
    return selected.associations.map((association, index) => ({
      id: `evidence-link-${index}-${association.to_observation_id}`,
      fromMarkerId: association.from_observation_id,
      toMarkerId: association.to_observation_id,
      gapSeconds: association.unobserved_gap_seconds,
      label: association.reason,
    }));
  }, [selected]);
  const nav = (name: Tab) => {
    setRingSetupOpen(false);
    if (name === "Settings") setSettingsPage("menu");
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
            ? "Sign in to SpatialGuard"
            : hostedWeb
              ? "Sign in to the hosted workspace"
              : "Local workspace unavailable"}
        </p>
        <p>
          {native || hostedWeb
            ? "Use your email and password to continue."
            : "Start SpatialGuard on your PC."}
        </p>
        {error && <RecoveryNotice message={error} />}
        {native || hostedWeb ? (
          <div className="button-row">
            <a className="primary" href={native ? "/?auth=signin" : "/signin"}>Sign in</a>
            <a href={native ? "/?auth=signup" : "/signup"}>Create account</a>
          </div>
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
  const heatGrid = heatmapOn && !selected && heat.data?.values.length ? heat.data : null;
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
                  disabled={v === "3D" && lowPower}
                  title={v === "3D" && lowPower ? "Turn off low-power mode in Settings to use 3D" : undefined}
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
          <p>Upload a drawing of your home to see every camera on a map.</p>
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
              heatmap={heatGrid}
              evidenceLinks={evidenceLinks}
              zoom={mapZoom}
              onZoomChange={setMapZoom}
              viewKey={mapViewKey}
              motion={motionMode && !lowPower}
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
                evidenceLinks={evidenceLinks}
                heatmap={heatGrid}
              />
            </Suspense>
          ) : <CameraWall compact />}
          {(view === "2D" || view === "3D") && heatmapOn && !selected && (
            <>
              <HeatmapPanel
                range={heatRange}
                onRange={setHeatRange}
                data={heat.data}
                loading={heat.loading}
                error={heat.error}
                cameraName={(id) => place.layout.cameras.find((c) => c.id === id)?.name ?? "a camera"}
              />
              {heatGrid && <HeatmapLegend />}
            </>
          )}
          {view === "3D" && !selected && (
            <MapControls
              compact
              motion={motionMode}
              people={heatmapOn}
              onMotion={() => setMotionMode((on) => !on)}
              onPeople={() => setHeatmapOn((on) => !on)}
              canZoomIn={false}
              canZoomOut={false}
              onZoomIn={() => {}}
              onZoomOut={() => {}}
              onFit={() => {}}
            />
          )}
          {view === "2D" && !selected && (
            <MapControls
              motion={motionMode}
              people={heatmapOn}
              onMotion={() => setMotionMode((on) => !on)}
              onPeople={() => setHeatmapOn((on) => !on)}
              canZoomIn={mapZoom < 4}
              canZoomOut={mapZoom > 0.65}
              onZoomIn={() => setMapZoom((z) => Math.min(4, z * 1.3))}
              onZoomOut={() => setMapZoom((z) => Math.max(0.65, z / 1.3))}
              onFit={() => {
                setMapZoom(1);
                setMapViewKey((k) => k + 1);
              }}
            />
          )}
          {selected?.evidence_mode === "live" && (
            <div className="evidence-map-legend" aria-label="Spatial evidence graph legend">
              <span><i className="evidence-observed" />Observed by camera</span>
              <span><i className="evidence-possible" />Possible continuation</span>
              <span><i className="evidence-unknown">?</i>Unknown gap</span>
            </div>
          )}
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
              ? "Traced from your drawing."
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
              : selected?.evidence_mode === "live"
                ? (incidentTrail.length ? "Recorded movement · estimated map positions" : "Camera observations · person position unknown")
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
              {site ? "Activity your cameras record shows up here." : "Add a floor plan to get started."}
            </p>
            {site && place.monitoring.enabled && place.monitoring.camera_ids.length > 0 && (
              <button onClick={replay} disabled={busy || running || !online}>
                <Play size={16} /> Run a test replay
              </button>
            )}
          </div>
        ) : (
          incidents.map((incident) => (
            <div className="incident-row" key={incident.id}>
              <button className="incident-row-main" onClick={() => choose(incident)}>
                <span className="incident-symbol">
                  {incident.classification ? <ActivityIcon classification={incident.classification} /> : <MapPin size={20} />}
                </span>
                <span>
                  <strong>{incident.title}</strong>
                  <small>
                    {stamp(incident.created_at)} ·{" "}
                    {incident.evidence_mode === "live"
                      ? "Live"
                      : incident.evidence_mode === "simulator"
                        ? "Simulator"
                        : "Replay"}
                  </small>
                  <em className={incident.status === "reviewed" ? "status-chip done" : "status-chip"}>
                    {incident.status === "reviewed" ? "Reviewed" : "Needs review"}
                  </em>
                </span>
              </button>
              <button
                className="incident-delete"
                type="button"
                aria-label={`Delete ${incident.title}`}
                title="Delete incident"
                onClick={(event) => deleteIncident(incident, event)}
                disabled={busy}
              >
                <Trash2 size={17} />
              </button>
            </div>
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
    <IncidentReview key={selected.id} incident={selected} cameras={place.layout.cameras}
      step={step} onSelect={setStep} onClose={() => setSelected(null)}
      map={map} image={image} imageError={imageError} onMovement={setIncidentTrail}
      consent={Boolean(accountPreferences?.classification_consent)} busy={busy} online={online} error={error}
      onReview={() => void act(async () => {
        setSelected(await request<Incident>(`/v1/incidents/${selected.id}/review`, "POST", {status: "reviewed"}));
        await refresh();
      })}
      onAnalyze={() => void act(async () => {
        setSelected(await request<Incident>(`/v1/incidents/${selected.id}/classify`, "POST"));
        await refresh();
      })}
    />
  );

  return (
    <div className={`app-shell${lowPower ? " low-power" : ""}`}>
      {pairTarget && site && (
        <PairCameraSheet
          siteId={site.id}
          camera={pairTarget}
          consent={!!accountPreferences?.ring_data_consent}
          onAllowRing={async () => {
            if (accountPreferences)
              await saveAccountPreferences({ ...accountPreferences, ring_data_consent: true });
          }}
          onConnectRing={() => {
            setPairTarget(null);
            setTab("Home");
            setRingSetupOpen(true);
          }}
          onPaired={() => {
            setRingVersion((v) => v + 1);
            void refresh();
          }}
          onClose={() => setPairTarget(null)}
        />
      )}
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
          <span>{environmentLabel}</span>
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
            <h1>{ringSetupOpen ? "Pair Ring cameras" : tab === "Settings" ? settingsLabels[settingsPage] : tab}</h1>
          </div>
          <div className="top-actions">
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
        {!online && <div className="connection" role="status">
          {`Disconnected · ${lastSync ? "last checked " + time(lastSync) : "reconnect to update"}`}
        </div>}
        {error && <RecoveryNotice message={error} onRetry={() => void refresh()} />}
        <main className="content">
          {ringSetupOpen && tab === "Home" && (
            <div className="ring-setup-page">
              <button className="back-button" onClick={() => setRingSetupOpen(false)}>
                <ArrowLeft size={17} /> Home
              </button>
              <header>
                <h2>Connect and pair Ring cameras</h2>
                
              </header>
              {accountPreferences?.ring_data_consent ? (
                <RingConnection sites={sites} refreshOnReturn={returnedFromRing} />
              ) : (
                <section className="ring-consent-required">
                  <h3>Allow Ring camera access</h3>
                  <p>SpatialGuard needs your permission to use your Ring cameras.</p>
                  <button className="primary" disabled={!accountPreferences} onClick={() => accountPreferences && void act(() => saveAccountPreferences({ ...accountPreferences, ring_data_consent: true }))}>Allow Ring access</button>
                </section>
              )}
            </div>
          )}
          {!ringSetupOpen && <>
          {(tab === "Home" || tab === "Incidents") && (
            <div className={tab === "Incidents" && !selected ? "incident-page" : "home-page"}>
              {site && (
                <div className={`monitor-bar${place.monitoring.enabled ? " on" : ""}`}>
                  <span className="monitor-dot" aria-hidden="true" />
                  <div className="monitor-text">
                    <strong>
                      {place.monitoring.enabled ? "Monitoring on" : "Monitoring paused"}
                    </strong>
                    <span>
                      {!place.monitoring.enabled
                        ? "No new incidents are recorded while paused."
                        : place.monitoring.camera_ids.length
                          ? `${place.monitoring.camera_ids.length} ${place.monitoring.camera_ids.length === 1 ? "camera" : "cameras"} monitored${place.monitoring.classification_enabled ? " · Activity labels on" : ""}`
                          : "No cameras selected. Turn cameras on in Cameras."}
                    </span>
                  </div>
                  <div className="button-row">
                    {place.monitoring.enabled ? (
                      <>
                        <button onClick={() => updateMonitoring(false)} disabled={busy || !online}>
                          <Pause size={16} />
                          <span>Pause</span>
                        </button>
                        {place.monitoring.camera_ids.length > 0 && (
                          <button className="primary" onClick={replay} disabled={busy || running || !online}>
                            <Play size={16} />
                            {running ? "Processing…" : "Run replay"}
                          </button>
                        )}
                      </>
                    ) : (
                      <button className="primary" onClick={() => updateMonitoring(true)} disabled={busy || !online}>
                        <Play size={16} />
                        <span>Resume monitoring</span>
                      </button>
                    )}
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
                detail
              ) : tab === "Home" ? (
                <>
                <button className="mobile-ring-setup" onClick={() => setRingSetupOpen(true)}>
                  <Link2 size={19} />
                  <span><strong>Connect Ring cameras</strong><small>Link your Ring account</small></span>
                  <ArrowUpRight size={17} />
                </button>
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
                      onPairCamera={setPairTarget}
                      onRemoveCamera={online ? confirmRemoveCamera : undefined}
                      ringVersion={ringVersion}
                      classificationEnabled={place.monitoring.classification_enabled}
                      onTestTrack={updateTestTrack}
                      onTestClassification={updateTestClassification}
                    />
                    {list}
                  </aside>
                </div>
                </>
              ) : (
                list
              )}
            </div>
          )}
          {tab === "Cameras" && (
            <CameraWorkspace
              site={site}
              initialCameraId={room}
              cameras={cameras}
              busy={busy}
              online={online}
              onToggle={(cameraId, checked) =>
                updateMonitoring(
                  place.monitoring.enabled,
                  checked
                    ? [...place.monitoring.camera_ids, cameraId]
                    : place.monitoring.camera_ids.filter((id) => id !== cameraId),
                )
              }
              onSelectCamera={setRoom}
              onPairCamera={setPairTarget}
              onRemoveCamera={online ? confirmRemoveCamera : undefined}
              ringVersion={ringVersion}
            />
          )}
          {tab === "Operations" && <Operations features={features} />}
          {tab === "Settings" && (
            <div className="settings-page">
              {settingsPage === "menu" ? (
                <nav className="settings-mobile-menu" aria-label="Settings sections">
                  {(["account", "places", "privacy", "ring", "devices", "display", "security", "delete"] as SettingsPage[]).map((page) => (
                    <button key={page} className={page === "delete" ? "danger-row" : undefined} onClick={() => setSettingsPage(page)}>
                      <span>{settingsLabels[page]}</span><ChevronRight size={17} />
                    </button>
                  ))}
                </nav>
              ) : (
                <button className="settings-back" onClick={() => setSettingsPage("menu")}>
                  <ArrowLeft size={17} /> Settings
                </button>
              )}
              {settingsPage === "account" && <>
              <section id="settings-account">
                <h2>Account</h2>
                <p>{currentSession?.email ?? "Local workspace owner"}</p>
                {currentSession?.email && (
                  <button
                    onClick={() => void act(async () => {
                      await request("/v1/auth/signout", "POST");
                      await clearToken();
                      window.location.assign(native ? "/" : "/");
                    })}
                  >
                    <LogOut size={16} /> Sign out
                  </button>
                )}
              </section>
              <section className="settings-getting-started">
                <h2>Getting started</h2>
                
                <button onClick={() => setOnboardingOpen(true)}>Open setup guide</button>
              </section>
              </>}
              {settingsPage === "places" && <section id="settings-places">
                <h2>Places</h2>
                <p>
                  {sites.length
                    ? "Removing a place also deletes its incidents."
                    : "No places yet."}
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
                
              </section>}
              {settingsPage === "privacy" && <section id="settings-privacy">
                <h2>Privacy</h2>
                
                {accountPreferences ? (
                  <div className="privacy-controls">
                    <label className="consent-choice">
                      <input type="checkbox" checked={accountPreferences.ring_data_consent}
                        onChange={(event) => setAccountPreferences({
                          ...accountPreferences,
                          ring_data_consent: event.target.checked,
                          classification_consent: event.target.checked ? accountPreferences.classification_consent : false,
                        })} />
                      <span><strong>Ring cameras</strong><small>Live view, events and camera status.</small></span>
                    </label>
                    <label className="consent-choice">
                      <input type="checkbox" disabled={!accountPreferences.ring_data_consent}
                        checked={accountPreferences.classification_consent}
                        onChange={(event) => setAccountPreferences({ ...accountPreferences, classification_consent: event.target.checked })} />
                      <span><strong>Activity labels</strong><small>Event snapshots are sent to OpenAI to label activity.</small></span>
                    </label>
                    <div className="retention-grid">
                      <label>Incident retention
                        <select value={accountPreferences.incident_retention_days}
                          onChange={(event) => setAccountPreferences({ ...accountPreferences,
                            incident_retention_days: Number(event.target.value) as 30 | 90 | 365 })}>
                          <option value={30}>30 days</option><option value={90}>90 days</option><option value={365}>1 year</option>
                        </select>
                      </label>
                      <label>Security audit retention
                        <select value={accountPreferences.audit_retention_days}
                          onChange={(event) => setAccountPreferences({ ...accountPreferences,
                            audit_retention_days: Number(event.target.value) as 90 | 365 | 730 })}>
                          <option value={90}>90 days</option><option value={365}>1 year</option><option value={730}>2 years</option>
                        </select>
                      </label>
                    </div>
                    <button className="primary" disabled={busy || !online}
                      onClick={() => void act(() => saveAccountPreferences(accountPreferences))}>Save privacy choices</button>
                    
                    <p className="legal-links"><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/data-deletion">Data deletion</a></p>
                  </div>
                ) : <p>Loading privacy choices…</p>}
              </section>}
              {settingsPage === "ring" && (accountPreferences?.ring_data_consent ? (
                <div id="settings-ring"><RingConnection sites={sites} refreshOnReturn={returnedFromRing} /></div>
              ) : (
                <section id="settings-ring">
                  <h2>Ring connection</h2>
                  <p>SpatialGuard needs your permission to use your Ring cameras.</p>
                  <button className="primary" disabled={!accountPreferences} onClick={() => accountPreferences && void act(() => saveAccountPreferences({ ...accountPreferences, ring_data_consent: true }))}>Allow Ring access</button>
                </section>
              ))}
              {settingsPage === "devices" && <>
              {localWeb && <section>
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
              </section>}
              <section id="settings-devices">
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
              </>}
              {settingsPage === "display" && <section className="settings-sessions">
                <h2>Display and performance</h2>
                <p>Uses the 2D map only and turns off animation.</p>
                <button aria-pressed={lowPower} onClick={() => setLowPower(value => !value)}>
                  {lowPower ? "Use full graphics" : "Turn on low-power mode"}
                </button>
                
              </section>}
              {settingsPage === "security" && <>
              {currentSession?.email ? (
                <AccountSecurity ringDataConsent={!!accountPreferences?.ring_data_consent} onSessionsChanged={() => void request<Session[]>("/v1/sessions").then(setSessions)} />
              ) : (
                <div className="security-page">
                  <section className="settings-card" id="settings-display">
                    <h2>Your data</h2>
                    <ul className="data-facts">
                      <li>Live video is never recorded by SpatialGuard.</li>
                      <li>Replay incidents use sample data, not your cameras.</li>
                    </ul>
                  </section>
                </div>
              )}
              <p className="app-version">SpatialGuard version 0.1</p>
              </>}
              {settingsPage === "delete" && currentSession?.email && (
                <section className="danger-zone">
                  <h2>Delete account</h2>
                  <p>Deletes your account and all its data. This can’t be undone.</p>
                  <button className="danger" onClick={() => setDeleteOpen(true)}>Delete my account</button>
                </section>
              )}
            </div>
          )}
          </>}
        </main>
      </div>
      {onboardingOpen && accountPreferences && (
        <Onboarding
          preferences={accountPreferences}
          onSave={saveAccountPreferences}
          onLoadSample={loadSample}
          onUploadPlan={() => {
            void saveAccountPreferences({ ...accountPreferences, onboarding_completed: true })
              .then(() => setImporting(true))
              .catch(handleError);
          }}
          onOpenSettings={() => setTab("Settings")}
        />
      )}
      {deleteOpen && (
        <div className="modal-backdrop" role="presentation">
          <section {...deleteDialog} className="delete-account-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-account-title">
            <button className="modal-close" aria-label="Close" onClick={() => setDeleteOpen(false)}><X size={18} /></button>
            <p className="eyebrow">Permanent action</p>
            <h2 id="delete-account-title">Delete SpatialGuard account?</h2>
            <p>This can’t be undone.</p>
            <label>Current password<input type="password" autoComplete="current-password" value={deletePassword}
              onChange={(event) => setDeletePassword(event.target.value)} /></label>
            <label>Type DELETE to confirm<input value={deleteConfirmation}
              onChange={(event) => setDeleteConfirmation(event.target.value)} /></label>
            {deleteError && <p className="form-error" role="alert">{deleteError}</p>}
            <div className="button-row">
              <button onClick={() => setDeleteOpen(false)}>Cancel</button>
              <button className="danger" disabled={busy || deletePassword.length < 8 || deleteConfirmation !== "DELETE"}
                onClick={() => void deleteAccount()}>{busy ? "Deleting…" : "Delete account permanently"}</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

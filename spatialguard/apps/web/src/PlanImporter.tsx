import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { AlertTriangle, Upload, X } from "lucide-react";
import Map2D from "@twinforge/spatial-view/Map2D";
import type { Layout } from "../../../../packages/sdk-typescript";
import type { components } from "./generated";
import { request } from "./platform";
const Scene3D = lazy(() => import("@twinforge/spatial-view/Scene3D"));
type PlanJob = components["schemas"]["PlanJob"];
type Site = components["schemas"]["Site"];
type Options = components["schemas"]["GenerationOptions"];

export default function PlanImporter({
  onClose,
  onAccepted,
  onLoadSample,
}: {
  onClose: () => void;
  onAccepted: (site: Site) => void;
  onLoadSample?: () => void;
}) {
  const [file, setFile] = useState<File | null>(null),
    [preview, setPreview] = useState(""),
    [name, setName] = useState(""),
    [height, setHeight] = useState(2.6);
  const [job, setJob] = useState<PlanJob | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [view, setView] = useState("2D"),
    [room, setRoom] = useState(""),
    [width, setWidth] = useState(""),
    [depth, setDepth] = useState("");
  const [vision, setVision] = useState(false),
    [visionAvailable, setVisionAvailable] = useState(false),
    [checkingVision, setCheckingVision] = useState(true);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    void request<Options>("/v1/generation-options")
      .then((options) => {
        if (!active) return;
        setVisionAvailable(options.vision_available);
        setVision(options.vision_available);
      })
      .catch(() => {})
      .finally(() => active && setCheckingVision(false));
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!file) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  // Tracing runs in TwinForge's worker; poll until it needs review or fails.
  useEffect(() => {
    if (!job || !["queued", "running"].includes(job.state)) return;
    const timer = setInterval(() => {
      void request<PlanJob>(`/v1/plans/${job.job_id}`)
        .then((next) => live.current && setJob(next))
        .catch((e) => {
          if (live.current)
            setError(e instanceof Error ? e.message : "Lost contact with the workspace.");
        });
    }, 900);
    return () => clearInterval(timer);
  }, [job]);

  useEffect(() => {
    if (job?.state === "needs_review" && job.traced_width_m && !width) {
      setWidth(String(job.traced_width_m));
      setDepth(String(job.traced_depth_m));
    }
  }, [job, width]);
  const choose = (selected?: File) => {
    setError("");
    if (!selected) return;
    if (!["image/png", "image/jpeg"].includes(selected.type))
      return setError("Choose a PNG or JPEG floor-plan drawing.");
    if (selected.size > 6_000_000)
      return setError("Choose an image smaller than 6 MB.");
    setFile(selected);
    if (!name.trim())
      setName(selected.name.replace(/\.[^.]+$/, "").slice(0, 100) || "My home");
  };
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed. Please try again.");
    } finally {
      if (live.current) setBusy(false);
    }
  };
  const generate = () =>
    void act(async () => {
      if (!file) return;
      const data_base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = () => reject(new Error("Unable to read this file."));
        reader.readAsDataURL(file);
      });
      setJob(
        await request<PlanJob>("/v1/plans", "POST", {
          name: name.trim() || "My home",
          media_type: file.type,
          data_base64,
          ceiling_height_m: height,
          vision_assisted: vision,
        }),
      );
    });
  const discard = () =>
    void act(async () => {
      if (job) await request(`/v1/plans/${job.job_id}`, "DELETE");
      setJob(null);
      setRoom("");
    });
  const accept = () =>
    void act(async () => {
      if (!job) return;
      onAccepted(
        await request<Site>(`/v1/plans/${job.job_id}/accept`, "POST", {
          width_m: Number(width),
          depth_m: Number(depth),
        }),
      );
    });

  const working = !!job && ["queued", "running"].includes(job.state);
  const ready = job?.state === "needs_review" && job.layout;
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && !working && onClose()}>
      <section className="modal plan-importer" role="dialog" aria-modal="true" aria-labelledby="plan-title">
        <div className="panel-heading">
          <h2 id="plan-title">Map from a floor plan</h2>
          <button aria-label="Close" disabled={working || busy} onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        {!job && (
          <form
            className="plan-form"
            onSubmit={(e) => {
              e.preventDefault();
              generate();
            }}
          >
            <p className="muted">
              Upload a drawing of one floor. TwinForge traces it into an editable 2D
              and 3D map that you can place cameras on.
            </p>
            <label className="plan-drop">
              <Upload size={20} />
              <span>{file ? file.name : "Choose a PNG or JPEG plan · up to 6 MB"}</span>
              <input
                type="file"
                accept="image/png,image/jpeg"
                aria-label="Floor plan image"
                onChange={(e) => choose(e.target.files?.[0])}
              />
            </label>
            {preview && <img className="plan-preview" src={preview} alt="Selected floor plan" />}
            <div className="plan-fields">
              <label>
                Place name
                <input
                  required
                  maxLength={100}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label>
                Assumed ceiling height (m)
                <input
                  type="number"
                  min="0.1"
                  max="20"
                  step="0.1"
                  required
                  value={height}
                  onChange={(e) => setHeight(Number(e.target.value))}
                />
              </label>
            </div>
            <label className="plan-vision">
              <input
                type="checkbox"
                checked={vision}
                disabled={checkingVision || !visionAvailable}
                onChange={(e) => setVision(e.target.checked)}
              />
              <span>
                Use GPT Sol to recognise rooms and ignore furniture
                {checkingVision && " — checking availability…"}
                {!checkingVision && !visionAvailable && " — unavailable on this server"}
              </span>
            </label>
            {vision ? (
              <p className="fine plan-disclosure">
                <AlertTriangle size={14} />
                <span>
                  This uploads your floor plan to OpenAI using the TwinForge server's
                  API key, and that account is billed for the request. The drawing
                  leaves this machine. If the model is unavailable or returns invalid
                  geometry, TwinForge traces locally instead and tells you so.
                </span>
              </p>
            ) : (
              <p className="fine">
                Local tracing only — the drawing stays on this PC. Furnished drawings
                may produce just an approximate footprint.
              </p>
            )}
            <p className="fine">
              Either way, scale is estimated from the drawing and never measured.
              Stairs, roofs, and window details are not traced, and rooms that open
              into each other without a door become one space.
            </p>
            {error && <p role="alert">{error}</p>}
            <div className="button-row">
              <button type="button" onClick={onClose}>
                Cancel
              </button>
              {onLoadSample && (
                <button type="button" disabled={busy} onClick={onLoadSample}>
                  Load sample instead
                </button>
              )}
              <button className="primary" disabled={!file || busy}>
                Trace floor plan
              </button>
            </div>
          </form>
        )}
        {working && (
          <div className="plan-progress">
            <p role="status">
              {job.state === "queued"
                ? "Queued — waiting for the TwinForge worker…"
                : vision
                  ? "Reading rooms with GPT Sol, checking the geometry, then building the draft…"
                  : "Reading walls and openings, then building the draft…"}
            </p>
            <progress aria-label="Tracing floor plan" />
            <p className="fine">
              This needs the local TwinForge worker running.{" "}
              {vision
                ? "Vision tracing can take up to a few minutes."
                : "Tracing usually takes a few seconds."}
            </p>
            <div className="button-row">
              <button onClick={discard} disabled={busy}>
                Cancel tracing
              </button>
            </div>
          </div>
        )}
        {job && ["failed", "cancelled"].includes(job.state) && (
          <div className="plan-progress">
            <p role="alert">{job.error || "Tracing was cancelled. Nothing was added."}</p>
            <div className="button-row">
              <button onClick={discard} disabled={busy}>
                Try another drawing
              </button>
            </div>
          </div>
        )}
        {ready && (
          <div className="plan-review">
            <div className="panel-heading">
              <h3>
                {job.rooms} {job.rooms === 1 ? "space" : "spaces"} · {job.connections}{" "}
                {job.connections === 1 ? "connection" : "connections"}
              </h3>
              <div className="view-toggle" aria-label="Preview view">
                {["2D", "3D"].map((v) => (
                  <button key={v} aria-pressed={view === v} onClick={() => setView(v)}>
                    {v}
                  </button>
                ))}
              </div>
            </div>
            <div className="map-area">
              {view === "2D" ? (
                <Map2D
                  layout={job.layout as Layout}
                  selected={room}
                  onSelect={setRoom}
                  background={preview}
                />
              ) : (
                <Suspense fallback={<p>Loading 3D…</p>}>
                  <Scene3D layout={job.layout as Layout} selected={room} onSelect={setRoom} />
                </Suspense>
              )}
            </div>
            <p className="fine plan-source">
              {job.vision_status === "completed"
                ? "Traced by GPT Sol from your drawing."
                : job.vision_status === "failed"
                  ? `GPT Sol did not produce usable geometry (${job.vision_error}) — TwinForge traced locally instead.`
                  : "Traced locally on this PC."}
            </p>
            {job.warning && <p role="status">{job.warning}</p>}
            <div className="plan-scale">
              <p>
                <strong>Measure two dimensions.</strong> Tracing estimates metres from
                assumed door widths, so camera ranges and coverage only mean anything
                once you measure the building. The drawing suggests about{" "}
                {job.traced_width_m} m × {job.traced_depth_m} m — replace these with
                measurements of the real building, outer wall to outer wall.
              </p>
              <div className="plan-fields">
                <label>
                  Overall width (m)
                  <input
                    type="number"
                    min="0.5"
                    max="1000"
                    step="0.1"
                    required
                    value={width}
                    onChange={(e) => setWidth(e.target.value)}
                  />
                </label>
                <label>
                  Overall depth (m)
                  <input
                    type="number"
                    min="0.5"
                    max="1000"
                    step="0.1"
                    required
                    value={depth}
                    onChange={(e) => setDepth(e.target.value)}
                  />
                </label>
              </div>
              <p className="fine">
                The width sets the scale and the depth is an independent check. If the
                two disagree with the drawing by more than 2%, nothing is published.
              </p>
            </div>
            <p className="fine">
              Scale basis: {job.scale_basis ?? "estimated"}. Room names:{" "}
              {job.label_reader && ["Tesseract", "vision"].includes(job.label_reader)
                ? "read from printed labels"
                : "not read from the drawing"}
              . Accepting records that you reviewed this traced geometry; it does not
              make it measured.
            </p>
            {error && <p role="alert">{error}</p>}
            <div className="button-row">
              <button onClick={discard} disabled={busy}>
                Discard
              </button>
              <button
                className="primary"
                onClick={accept}
                disabled={busy || !(Number(width) > 0) || !(Number(depth) > 0)}
              >
                Use this map
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, Check, Map as MapIcon } from "lucide-react";
import type { components } from "./generated";
import type { Camera } from "../../../../packages/sdk-typescript";
import type { Marker } from "@twinforge/spatial-view/Map2D";
import { ActivityIcon } from "./activityPresentation";
import IncidentRecording from "./IncidentRecording";
import IncidentTimeline, { eventTime, type PlaybackPosition } from "./IncidentTimeline";

type Incident = components["schemas"]["Incident"];
type Pane = "Evidence" | "Timeline" | "Map";
const panes: Pane[] = ["Evidence", "Timeline", "Map"];
export default function IncidentReview({ incident, cameras, step, onSelect, onClose, onReview, onAnalyze,
  onMovement, map, image, imageError, consent, busy, online, error }: {
  incident: Incident; cameras: Camera[]; step: number; onSelect: (step: number) => void;
  onClose: () => void; onReview: () => void; onAnalyze: () => void;
  onMovement: (markers: Marker[]) => void; map: ReactNode; image: string; imageError: string;
  consent: boolean; busy: boolean; online: boolean; error: string;
}) {
  const [compact, setCompact] = useState(() => matchMedia("(max-width: 760px)").matches);
  const [pane, setPane] = useState<Pane>("Evidence");
  const [playback, setPlayback] = useState<PlaybackPosition>({ seconds: 0, duration: 0 });
  const heading = useRef<HTMLHeadingElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const media = matchMedia("(max-width: 760px)");
    const update = () => setCompact(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const prior = document.activeElement as HTMLElement | null;
    heading.current?.focus({ preventScroll: true });
    return () => { if (prior?.isConnected) prior.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => {
    if (!compact) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = overflow; };
  }, [compact]);
  useEffect(() => { setPlayback({seconds: 0, duration: 0}); }, [incident.id, step]);
  const observation = incident.observations[step];
  const camera = cameras.find(item => item.id === observation?.source_id);
  const mode = incident.evidence_mode === "live" ? "Live integration" : incident.evidence_mode === "simulator" ? "Official simulator" : "Replay";
  const select = (index: number) => { onSelect(index); scroll.current?.scrollTo({top: 0}); };
  const reviewButton = <button className="primary incident-review-action" disabled={incident.status === "reviewed" || busy || !online} onClick={onReview}>
    <Check size={16} />{incident.status === "reviewed" ? "Reviewed" : "Mark reviewed"}
  </button>;
  const timeline = <IncidentTimeline incident={incident} cameras={cameras} step={step} onSelect={select} playback={playback} compact={compact} />;

  return <div className="review-layout incident-review" onKeyDown={event => { if (event.key === "Escape") onClose(); }}>
    {!compact && <div className="incident-spatial-column">{map}{timeline}</div>}
    <section className="detail incident-review-detail" aria-labelledby="incident-review-title">
      <header className="incident-review-header">
        <div className="incident-review-nav"><button className="incident-back" onClick={onClose} aria-label="Back to all incidents"><ArrowLeft size={18} /><span>All incidents</span></button><span className="mode">{mode}</span></div>
        <div className="incident-title-row"><div><h2 id="incident-review-title" tabIndex={-1} ref={heading}>{incident.title}</h2><p>{eventTime(observation?.observed_at ?? incident.created_at)} · {camera?.name ?? "Camera unavailable"}</p></div><div className="desktop-review-action">{reviewButton}</div></div>
      </header>
      <div className="incident-review-scroll" ref={scroll} tabIndex={0} aria-label="Incident evidence and details">
        {(!online || error) && <p className="incident-review-notice" role="status">{error || "Disconnected. Reconnect to review or analyze this incident."}</p>}
        <div className="evidence-view incident-media">
          {incident.evidence_mode === "live" && observation ? <IncidentRecording key={observation.observation_id} incidentId={incident.id} observationId={observation.observation_id} camera={camera} classification={incident.classification} onMovement={onMovement} onPlayback={setPlayback} />
            : image ? <><img src={image} alt="Synthetic replay illustration of a person, not camera footage" /><p className="incident-media-note">Synthetic replay illustration · {camera?.name ?? "Unknown camera"}</p></>
            : <p role="status">{incident.evidence_mode === "live" ? "Select a camera event to load its recording. Activity position remains unknown." : observation?.location.kind === "unknown" ? "Unknown location — no footage or coordinate evidence for this gap." : imageError || "Loading evidence…"}</p>}
        </div>
        {compact && <div className="incident-review-tabs" role="tablist" aria-label="Incident sections">
          {panes.map((item, index) => <button key={item} id={`incident-tab-${item}`} role="tab" aria-selected={pane === item} aria-controls={`incident-pane-${item}`} tabIndex={pane === item ? 0 : -1} onClick={() => setPane(item)} onKeyDown={event => {
            const next = event.key === "ArrowRight" ? (index + 1) % panes.length : event.key === "ArrowLeft" ? (index + panes.length - 1) % panes.length : event.key === "Home" ? 0 : event.key === "End" ? panes.length - 1 : null;
            if (next !== null) { event.preventDefault(); setPane(panes[next]); document.getElementById(`incident-tab-${panes[next]}`)?.focus(); }
          }}>{item === "Map" && <MapIcon size={15} />}{item}</button>)}
        </div>}
        <div id="incident-pane-Evidence" role={compact ? "tabpanel" : undefined} aria-labelledby={compact ? "incident-tab-Evidence" : undefined} hidden={compact && pane !== "Evidence"}>
          {incident.classification ? <section className="classification-card" aria-label="AI snapshot classification">
            <div className="incident-classification-heading"><ActivityIcon classification={incident.classification} /><strong>{incident.classification.display_label}</strong></div>
            <span className={`confidence confidence-${incident.classification.confidence}`}>{incident.classification.confidence} confidence</span>
            <p>{incident.classification.summary}</p>
            <details><summary>What supports this classification?</summary><ul>{incident.classification.visible_evidence.map(item => <li key={item}>{item}</li>)}</ul><p>{incident.classification.uncertainty}</p><p>AI interpretation, review required. Identity is unconfirmed.</p></details>
          </section> : incident.evidence_mode === "live" ? <section className="classification-card classification-empty">
            <strong>{incident.classification_status === "unavailable" ? "Classification unavailable" : "Not analyzed"}</strong>
            <button disabled={busy || !online || !consent} onClick={onAnalyze}>Analyze snapshot</button>
            <p>{consent ? "Analyze the latest authorized camera snapshot. The image is sent to OpenAI for this request and is not stored by SpatialGuard." : "Allow Ring data and snapshot classification in Privacy settings before sending an image to OpenAI."}</p>
          </section> : null}
          <section className="evidence-inspector" aria-label="Selected evidence details">
            <h3>Evidence details</h3><dl>
              <div><dt>Timestamp</dt><dd>{observation ? eventTime(observation.observed_at) : "Unavailable"}</dd></div>
              <div><dt>Camera</dt><dd>{camera?.name ?? "Unknown camera"}</dd></div>
              <div><dt>Person</dt><dd>{incident.classification?.display_label ?? "Unknown"} · identity unconfirmed</dd></div>
              <div><dt>Evidence mode</dt><dd>{incident.evidence_mode === "live" ? "Live Ring event" : mode === "Replay" ? "Synthetic replay" : mode}</dd></div>
              <div><dt>Media</dt><dd>{image ? "Replay illustration" : incident.evidence_mode === "live" ? "Recording requested from Ring; availability shown in the player" : "Unavailable"}</dd></div>
              <div><dt>Trigger</dt><dd>{incident.rule}</dd></div>
              <div><dt>Certainty</dt><dd>{incident.evidence_mode === "live" ? "Observed camera event. Any movement shown is estimated from recording; identity is unknown." : observation?.location.kind === "unknown" ? "Unknown location — coverage gap" : "Illustrative replay position"}</dd></div>
            </dl>
          </section>
          <p className="incident-revision-note">Layout revision {incident.revision_id}. {incident.evidence_mode === "live" ? "Camera calibration is unavailable." : "Synthetic replay positions."}</p>
        </div>
        {compact && <div id="incident-pane-Timeline" role="tabpanel" aria-labelledby="incident-tab-Timeline" hidden={pane !== "Timeline"}>{timeline}</div>}
        {compact && <div id="incident-pane-Map" role="tabpanel" aria-labelledby="incident-tab-Map" hidden={pane !== "Map"}>{pane === "Map" && map}</div>}
      </div>
      {compact && <footer className="review-footer"><span>Pinned revision {incident.revision_id.slice(-6)}<br />{incident.evidence_mode === "live" ? "Map positions are estimates" : "Synthetic replay"}</span>{reviewButton}</footer>}
    </section>
  </div>;
}

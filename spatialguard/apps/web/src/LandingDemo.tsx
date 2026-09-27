import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronRight, Pause, Play, RotateCcw } from "lucide-react";
import Map2D, { type Marker } from "@twinforge/spatial-view/Map2D";
import TopDownPerson from "@twinforge/spatial-view/TopDownPerson";
import type { Layout } from "../../../../packages/sdk-typescript";
import CameraMark from "./CameraMark";

const Scene3D = lazy(() => import("@twinforge/spatial-view/Scene3D"));
const provenance = { kind: "manual" as const, confirmed: false, explanation: "Authored synthetic landing-page demonstration, not a real property." };
const room = (id: string, name: string, x: number, y: number, w: number, h: number) => ({
  id, name, floor_id: "ground", height_m: 2.6, provenance,
  polygon_xy_m: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]] as [number, number][],
});
const layout: Layout = {
  schema_version: "0.1", units: "meters", world_frame: "RH_Xright_Yforward_Zup", scale_status: "unknown", scale_anchors: [],
  floors: [{ id: "ground", name: "Ground floor", elevation_m: 0 }],
  rooms: [room("living", "Living room", 0, 0, 5, 4), room("kitchen", "Kitchen", 0, 4, 5, 3), room("hall", "Hallway", 5, 0, 2, 7), room("bedroom", "Bedroom", 7, 3, 4, 4), room("garage", "Garage", 7, 0, 4, 3)],
  zones: [],
  portals: [
    { id: "living-hall-door", name: "Living room door", from_room_id: "living", to_room_id: "hall", segment_xy_m: [[5, 1.2], [5, 2.1]], width_m: .9, state: "open", state_observed_at: null, provenance },
    { id: "kitchen-hall-door", name: "Kitchen door", from_room_id: "kitchen", to_room_id: "hall", segment_xy_m: [[5, 4.7], [5, 5.6]], width_m: .9, state: "open", state_observed_at: null, provenance },
    { id: "hall-bedroom-door", name: "Bedroom door", from_room_id: "hall", to_room_id: "bedroom", segment_xy_m: [[7, 4.2], [7, 5.1]], width_m: .9, state: "closed", state_observed_at: null, provenance },
    { id: "hall-garage-door", name: "Garage door", from_room_id: "hall", to_room_id: "garage", segment_xy_m: [[7, 1.1], [7, 2]], width_m: .9, state: "closed", state_observed_at: null, provenance },
  ],
  asset_ids: [], floor_plan: null,
  cameras: [
    { id: "front", name: "Front entrance", floor_id: "ground", position_m: [5.8, 0, 2.2], heading_degrees: 270, pitch_degrees: 0, fov_degrees: 100, range_m: 5.5, configuration_hash: "landing-front", provenance },
    { id: "side", name: "Side gate", floor_id: "ground", position_m: [11, 3, 2.2], heading_degrees: 0, pitch_degrees: 0, fov_degrees: 85, range_m: 4, configuration_hash: "landing-side", provenance },
  ],
};
const moments = [
  { time: "08:42:01", title: "Person approaches", detail: "A person is visible at the front entrance. The map shows an estimated position.", label: "Person · not classified" },
  { time: "08:42:04", title: "Possible delivery", detail: "Parcel visible in their hands. The activity label suggests delivery, with evidence for you to review.", label: "Delivery worker · possible" },
  { time: "08:42:08", title: "Package placed", detail: "The example shows a parcel placed near the entrance, followed by the person turning away.", label: "Delivery worker · possible" },
  { time: "08:42:12", title: "Person walks away", detail: "The estimated trail stays on the map as the person moves back toward the camera boundary.", label: "Delivery worker · possible" },
  { time: "08:42:15", title: "No longer visible", detail: "Position unknown. The person marker disappears; the recorded path stays for review. No route is invented beyond the camera view.", label: "Position unknown" },
];
const path: [number, number][] = [[4.3, -4.2], [4.5, -3.6], [4.8, -3], [5.1, -2.4], [5.35, -1.8], [5.5, -1.2], [5.55, -.8], [5.5, -1.2], [5.4, -1.8], [5.15, -2.5], [4.9, -3.2], [4.7, -4.1]];
const counts = [3, 6, 7, 12, 12];

export default function LandingDemo() {
  const [step, setStep] = useState(2);
  const [playing, setPlaying] = useState(false);
  const [view, setView] = useState("2D");
  const [selected, setSelected] = useState("front");
  const [camera, setCamera] = useState("front");
  const [reviewed, setReviewed] = useState(false);
  const onSelect = useCallback((id: string) => { setSelected(id); if (id === "front" || id === "side") setCamera(id); }, []);
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setStep(value => Math.min(value + 1, 4)), 2200);
    return () => clearInterval(timer);
  }, [playing]);
  useEffect(() => { if (step === 4) setPlaying(false); }, [step]);
  const markers = useMemo<Marker[]>(() => path.slice(0, counts[step]).map((xy, i) => ({
    id: `demo-${i}`, xy, approximate: true, selected: i === counts[step] - 1 && step < 4,
    actorKind: step === 0 ? "person" : "delivery", actorLabel: moments[step].label,
    uncertainty_m: .6, headingDegrees: step < 3 ? 75 : 255,
  })), [step]);
  const reset = () => { setStep(0); setPlaying(false); setReviewed(false); onSelect("front"); };
  return <section className="lp-demo-section" id="demo" aria-labelledby="lp-demo-title">
    <div className="lp-section-heading"><div><h2 id="lp-demo-title">See the delivery.<br /><span>Follow the whole moment.</span></h2><p>Try the workflow: select a camera, step through the activity, and switch between the same 2D and 3D home map.</p></div><span className="lp-demo-disclosure">Interactive example<br />Synthetic replay · not camera footage</span></div>
    <div className="lp-workspace">
      <header className="lp-demo-bar"><span><span className="lp-demo-logo"><CameraMark size={18} /></span>Example home <small>Ground floor</small></span><div role="group" aria-label="Demo map view">{["2D", "3D"].map(mode => <button key={mode} aria-pressed={view === mode} onClick={() => setView(mode)}>{mode}</button>)}</div></header>
      <div className="lp-demo-content">
        <div className="lp-demo-map"><Suspense fallback={<p role="status">Loading 3D map…</p>}>{view === "2D" ? <Map2D layout={layout} selected={selected} onSelect={onSelect} markers={markers} fitBuilding /> : <Scene3D layout={layout} selected={selected} onSelect={onSelect} markers={markers} />}</Suspense><div className="lp-map-note">{step === 4 ? "Path retained · current position unknown" : "Estimated movement · illustrative replay"}</div></div>
        <aside className="lp-demo-evidence" aria-label="Example camera evidence">
          <div className="lp-camera-tabs">{layout.cameras.map(c => <button key={c.id} aria-pressed={camera === c.id} onClick={() => onSelect(c.id)}><CameraMark size={15} />{c.name}</button>)}</div>
          <div className="lp-evidence-art" aria-label={camera === "front" ? "Synthetic entrance illustration" : "No evidence for the side gate"}>
            {camera === "front" ? <svg viewBox="0 0 320 165" role="img" aria-label="Illustration of a parcel at the entrance">
              <rect width="320" height="165" fill="#e1e3f1" /><path d="M0 127L94 82H252L320 127V165H0Z" fill="#c2c6de" />
              <path d="M54 0H269V126H54Z" fill="#f1f2f9" /><path d="M122 14H204V126H122Z" fill="#a5aacd" /><path d="M134 25H192V111H134Z" fill="#b9bfdd" /><circle cx="185" cy="75" r="3" fill="#5b4fe8" />
              <path d="M90 127H239L254 142H74Z" fill="#9098bd" /><rect x="209" y="99" width="27" height="24" rx="1" fill="#d6a469" /><path d="M220 99V110H226V99" fill="#f3dbb9" />
              {step < 4 && <g transform={`translate(${step < 2 ? 66 : step === 2 ? 110 : 48} 105) scale(.7)`}><TopDownPerson kind={step === 0 ? "person" : "delivery"} /></g>}
            </svg> : <div className="lp-no-evidence"><CameraMark size={29} /><span>No observation in this example</span></div>}
            <span>Illustration · {moments[step].time}</span>
          </div>
          <div className="lp-evidence-copy" aria-live="polite"><span className="lp-evidence-label">{camera === "front" ? moments[step].label : "Side gate · no evidence"}</span><h3>{camera === "front" ? moments[step].title : "A camera is not an observation"}</h3><p>{camera === "front" ? moments[step].detail : "Selecting another camera shows its location. It does not imply the same person was seen there."}</p></div>
          <button className="lp-review" onClick={() => setReviewed(!reviewed)}><Check size={15} />{reviewed ? "Example reviewed · undo" : "Mark example reviewed"}</button>
        </aside>
      </div>
      <div className="lp-replay-controls"><button onClick={() => { if (step === 4) setStep(0); setPlaying(!playing); }} aria-label={playing ? "Pause delivery replay" : "Play delivery replay"}>{playing ? <Pause size={16} /> : <Play size={16} />}{playing ? "Pause" : "Play replay"}</button><div className="lp-timeline" role="group" aria-label="Delivery timeline">{moments.map((moment, i) => <button key={moment.time} aria-pressed={step === i} onClick={() => { setStep(i); setPlaying(false); }}><time>{moment.time}</time><span>{moment.title}</span></button>)}</div><button className="lp-reset" onClick={reset} aria-label="Reset delivery example"><RotateCcw size={17} /></button></div>
    </div>
    <div className="lp-demo-foot"><span><Check size={15} /> Same map components as the workspace</span><p>Movement is currently available for test-video replay. Live Ring events can be classified; continuous live tracking and reliable cross-camera identity are not yet supported.</p><a href="/">Try your own workspace <ChevronRight size={16} /></a></div>
  </section>;
}

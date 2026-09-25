import { Fragment } from "react";
import { ArrowRight, HelpCircle, Link2, Video } from "lucide-react";
import type { components } from "./generated";
import type { Camera } from "../../../../packages/sdk-typescript";

type Incident = components["schemas"]["Incident"];
export type PlaybackPosition = { seconds: number; duration: number };
export const eventTime = (value: string | number) => new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
export const clipTime = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

export default function IncidentTimeline({ incident, cameras, step, onSelect, playback, compact = false }: {
  incident: Incident; cameras: Camera[]; step: number; onSelect: (step: number) => void;
  playback: PlaybackPosition; compact?: boolean;
}) {
  const events = incident.observations.map((observation, index) => ({ ...observation, index }))
    .sort((a, b) => Date.parse(a.observed_at) - Date.parse(b.observed_at));
  const unknown = (event: typeof events[number]) => incident.evidence_mode !== "live" && event.location.kind === "unknown";
  const cameraName = (id: string) => cameras.find(camera => camera.id === id)?.name ?? id;
  const selected = events.find(event => event.index === step);
  const first = events.length ? Date.parse(events[0].observed_at) : Date.parse(incident.created_at);
  const last = events.length ? Date.parse(events[events.length - 1].observed_at) : first;
  const start = first - 15000;
  const end = Math.max(last + 15000, (selected ? Date.parse(selected.observed_at) : last) + playback.duration * 1000 + 5000);
  const percent = (at: number) => Math.max(0, Math.min(100, (at - start) / (end - start) * 100));
  const cursor = selected ? percent(Date.parse(selected.observed_at) + playback.seconds * 1000) : null;
  const observed = events.filter(event => !unknown(event));
  const cameraIds = Array.from(new Set([...cameras.map(camera => camera.id), ...observed.map(event => event.source_id)]));
  const eventLabel = (event: typeof events[number]) => unknown(event) ? "Unknown · coverage gap"
    : `Observed · ${cameraName(event.source_id)}`;

  return <section className={`incident-event-timeline${compact ? " is-compact" : ""}`} aria-label="Event timeline">
    <div className="incident-timeline-heading"><h3>Event timeline</h3>
      <span className="playback-clock">{playback.duration > 0 ? `Video at ${clipTime(playback.seconds)}` : `${observed.length} camera observation${observed.length === 1 ? "" : "s"}`}</span>
    </div>
    {events.length === 0 ? <p className="timeline-empty">No observations are available for this incident.</p> : compact ? <>
      <ol className="incident-event-list">
        <li className="event-gap"><HelpCircle size={20} /><div><small>Before {eventTime(first)}</small><strong>Unknown gap</strong><span>No earlier observation in this incident</span></div></li>
        {events.map(event => {
          const association = incident.associations.find(item => item.to_observation_id === event.observation_id);
          return <Fragment key={event.observation_id}>
            {association && <li className="event-association"><Link2 size={20} /><div><strong>Possible continuation · {association.unobserved_gap_seconds}s unobserved</strong><details><summary>Why only possible?</summary><p>{association.reason}</p><p>The route and whether this is the same person are unconfirmed.</p></details></div></li>}
            <li className={unknown(event) ? "event-gap" : "event-observed"}>
              {unknown(event) ? <HelpCircle size={20} /> : <span className="event-observed-dot" />}
              <button aria-pressed={step === event.index} onClick={() => onSelect(event.index)}>
                <time>{eventTime(event.observed_at)}</time><strong>{eventLabel(event)}</strong>
                <span>{event.category.replaceAll("_", " ")} · {event.location.kind === "unknown" ? "position unknown" : "position supplied"}</span>
                {incident.evidence_mode === "live" && <span className="event-recording-link"><Video size={14} />{step === event.index && playback.duration > 0 ? `Recording ${clipTime(playback.duration)}` : "View recording"}<ArrowRight size={14} /></span>}
              </button>
            </li>
          </Fragment>;
        })}
        <li className="event-gap"><HelpCircle size={20} /><div><small>After {eventTime(last)}</small><strong>Unknown continuation</strong><span>No later camera observation in this incident</span></div></li>
      </ol>
      <div className="incident-camera-summary"><h4>Camera by camera</h4>{cameraIds.map(id => <div key={id}><span>{cameraName(id)}</span><span>{events.some(event => event.source_id === id && !unknown(event)) ? `${events.filter(event => event.source_id === id && !unknown(event)).length} observations` : "No activity in this incident"}</span></div>)}</div>
    </> : <>
      <div className="incident-timeline-legend"><span><i className="timeline-observed-key" />Observed {observed.length}</span><span><i className="timeline-possible-key" />Possible continuation {incident.associations.length}</span><span><HelpCircle size={13} />Unknown position / gap</span></div>
      <div className="incident-timeline-scroll" tabIndex={0} aria-label="Camera timeline, scroll horizontally for more detail">
        <div className="incident-timeline-chart" style={{minWidth: Math.max(450, events.length * 52 + 128)}}>
          <div className="timeline-axis"><span /> <div>{[0, 1, 2, 3, 4].map(tick => <time key={tick} style={{ left: `${tick * 25}%` }}>{eventTime(start + (end - start) * tick / 4)}</time>)}</div></div>
          <div className="timeline-lane"><div className="timeline-lane-title">Activity<span>Identity unconfirmed</span></div><div className="timeline-track position-track">
            <span className="timeline-unknown-strip" title="Position unknown between observations" />
            {incident.associations.map(association => {
              const from = events.find(event => event.observation_id === association.from_observation_id);
              const to = events.find(event => event.observation_id === association.to_observation_id);
              if (!from || !to) return null;
              const left = percent(Date.parse(from.observed_at));
              return <span key={`${from.observation_id}-${to.observation_id}`} className="timeline-association-line" style={{left: `${left}%`, width: `${Math.max(0, percent(Date.parse(to.observed_at)) - left)}%`}} title={`Possible continuation · ${association.unobserved_gap_seconds}s unobserved. ${association.reason}`} />;
            })}
            {events.map(event => <button className={`timeline-event-dot${unknown(event) ? " is-gap" : ""}`} key={event.observation_id} aria-pressed={step === event.index} aria-label={`${eventTime(event.observed_at)} ${eventLabel(event)}`} title={`${eventTime(event.observed_at)} ${eventLabel(event)}`} style={{ left: `${percent(Date.parse(event.observed_at))}%` }} onClick={() => onSelect(event.index)}>{unknown(event) ? "?" : ""}</button>)}
            {cursor !== null && playback.duration > 0 && <span className="timeline-playhead" style={{left: `${cursor}%`}} />}
          </div></div>
          {cameraIds.map(id => <div className="timeline-lane" key={id}><div className="timeline-lane-title">{cameraName(id)}</div><div className="timeline-track">
            {!observed.some(event => event.source_id === id) && <span className="timeline-no-activity">No activity in this incident</span>}
            {observed.filter(event => event.source_id === id).map(event => <button className={`timeline-camera-event${observed.filter(item => item.source_id === id).length > 1 ? " is-dense" : ""}`} key={event.observation_id} aria-pressed={step === event.index} aria-label={`View ${cameraName(id)} event at ${eventTime(event.observed_at)}`} onClick={() => onSelect(event.index)} style={{left: `${percent(Date.parse(event.observed_at))}%`, maxWidth: `calc(${100 - percent(Date.parse(event.observed_at))}% + 12px)`}} title={`${eventTime(event.observed_at)} · ${event.category.replaceAll("_", " ")}`}><Video size={14} /><span>{event.category.replaceAll("_", " ")}{step === event.index && playback.duration > 0 ? ` · ${clipTime(playback.duration)}` : ""}</span><ArrowRight size={14} /></button>)}
            {cursor !== null && playback.duration > 0 && <span className="timeline-playhead" style={{left: `${cursor}%`}} />}
          </div></div>)}
        </div>
      </div>
      {selected && <p className="timeline-selected-caption">Selected: {eventTime(selected.observed_at)} · {eventLabel(selected)}{playback.duration > 0 ? ` · Recording ${clipTime(playback.duration)}` : ""}</p>}
      {incident.associations.length > 0 && <details className="timeline-reason"><summary>About possible continuations</summary>{incident.associations.map((association, i) => <p key={i}>Possible continuation · {association.unobserved_gap_seconds}s unobserved. {association.reason} The route and identity remain unconfirmed.</p>)}</details>}
    </>}
  </section>;
}

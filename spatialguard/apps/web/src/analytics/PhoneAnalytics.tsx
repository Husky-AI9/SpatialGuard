/**
 * Site Analytics on a phone (the iOS app), after the "Site analytics, phone"
 * design (PhoneAnalytics/PhoneAnalytics.dc.html): a headline card, a four-way
 * view selector and exactly one chart on screen at a time.
 *
 * When: a day-by-hour grid of the week (tap a square to read it).
 * Where: busiest zones, quiet zones and queue/crowding alerts.
 * Arrivals: where visits started.
 * Accuracy: how sure the numbers are, and the weekly AI note.
 */
import { useState } from "react";
import { Sparkles, TrendingDown, TrendingUp, Minus, Info, RefreshCw } from "lucide-react";
import type { AnalyticsViewProps } from "./AnalyticsView";
import AlertsCard from "./AlertsCard";
import "./phone.css";

type Tab = "when" | "where" | "arrivals" | "accuracy";
const TABS: [Tab, string][] = [["when", "When"], ["where", "Where"], ["arrivals", "Arrivals"], ["accuracy", "Accuracy"]];
const RAMP = ["#A79EF4", "#8A7FEF", "#6D5FEA", "#4F42D6", "#3A2FB0"];
const EMPTY = "#F1F0F8";

export type PhoneAnalyticsProps = AnalyticsViewProps & {
  onExport: () => void;
  onPair: () => void;
};

const hour = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 || h === 24 ? "AM" : "PM"}`;
/** "5 to 7 PM", or "11 AM to 1 PM" when the range crosses noon. */
const span = (from: number, to: number) => {
  const a = hour(from), b = hour(to);
  return a.slice(-2) === b.slice(-2) ? `${a.slice(0, -3)} to ${b}` : `${a} to ${b}`;
};
const weekday = (date: string, style: "short" | "long" = "short") =>
  new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: style });
const monthDay = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const visitsWord = (n: number) => `${n} ${n === 1 ? "visit" : "visits"}`;
const duration = (seconds: number | null | undefined) => {
  if (seconds == null) return null;
  if (seconds < 60) return `${Math.round(seconds)} sec`;
  const m = Math.floor(seconds / 60), s = Math.round(seconds % 60);
  return s ? `${m} min ${s} sec` : `${m} min`;
};
const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

function Chevron({ color = "#5B5E78" }: { color?: string }) {
  return <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M2 3.5l3 3 3-3" /></svg>;
}

export default function PhoneAnalytics(props: PhoneAnalyticsProps) {
  const { data, loading, error, sites, siteId } = props;
  const [tab, setTab] = useState<Tab>("when");
  const [pick, setPick] = useState<{ day: number; h: number } | null>(null);
  const [table, setTable] = useState(false);
  const [zonesOpen, setZonesOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [menu, setMenu] = useState<"" | "period" | "site">("");
  const site = sites.find((s) => s.site_id === siteId);

  const header = (
    <>
      <header className="pa-header">
        <h1>Analytics</h1>
        <button className="pa-export" aria-label="Export analytics" onClick={props.onExport} disabled={!data}>
          <svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="#23253F" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 2v8M4.5 6.5L8 10l3.5-3.5M2.5 13.5h11" /></svg>
        </button>
      </header>
      <div className="pa-filters">
        <button className="pa-chip is-on" aria-expanded={menu === "period"} onClick={() => setMenu(menu === "period" ? "" : "period")}>
          {data ? `Last 7 days, ${monthDay(data.daily[0].date)} to ${new Date(`${data.daily[6].date}T12:00:00`).getDate()}` : "Last 7 days"}
          <Chevron color="#3A34A8" />
        </button>
        <button className="pa-chip" aria-expanded={menu === "site"} disabled={sites.length < 2}
          onClick={() => setMenu(menu === "site" ? "" : "site")}>
          Layout: {site?.name ?? data?.site_name ?? "—"}{sites.length > 1 && <Chevron />}
        </button>
      </div>
      {menu && (
        <div className="pa-menu" role="menu">
          {menu === "period" ? (
            <>
              <button role="menuitemradio" aria-checked="true" onClick={() => setMenu("")}>Last 7 days vs the 7 before <span aria-hidden="true">✓</span></button>
              <p>Longer ranges are coming soon.</p>
            </>
          ) : sites.map((s) => (
            <button key={s.site_id} role="menuitemradio" aria-checked={s.site_id === siteId}
              onClick={() => { setMenu(""); setPick(null); props.onSite(s.site_id); }}>
              {s.name}<small>{visitsWord(s.visits)}</small>{s.site_id === siteId && <span aria-hidden="true">✓</span>}
            </button>
          ))}
        </div>
      )}
    </>
  );

  if (!data) {
    return (
      <div className="pa-page">
        {header}
        <div className="pa-body">
          <section className="pa-card pa-message" role={error ? "alert" : "status"}>
            <p>{error || (loading ? "Loading analytics…" : "No analytics yet.")}</p>
            {error && <button className="pa-primary" onClick={props.onRetry}>Try again</button>}
          </section>
        </div>
      </div>
    );
  }

  const totals = data.totals;
  const days = data.daily.map((d) => d.date);
  const grid = data.week_grid;
  const previousGrid = data.week_grid_previous ?? [];
  const dayTotals = grid.map((row) => row.reduce((a, b) => a + b, 0));
  const hourTotals = Array.from({ length: 24 }, (_, h) => grid.reduce((a, row) => a + (row[h] ?? 0), 0));
  const cellMax = Math.max(1, ...grid.flat());
  const hourMax = Math.max(1, ...hourTotals);

  // The busiest window of up to two consecutive hours in the week, e.g. "Sunday, 5 to 7 PM (2 visits)".
  const busiest = (() => {
    if (!totals.visits) return null;
    let best = { day: 0, from: 0, to: 1, count: -1 };
    grid.forEach((row, day) => {
      for (let h = 0; h < 24; h++) {
        const pair = row[h] + (h < 23 ? row[h + 1] : 0);
        if (row[h] > 0 && pair > best.count)
          best = { day, from: h, to: h < 23 && row[h + 1] > 0 ? h + 2 : h + 1, count: pair };
      }
    });
    return best;
  })();
  const busiestText = busiest ? `${weekday(days[busiest.day], "long")}, ${span(busiest.from, busiest.to)}` : null;
  const change = totals.visits - totals.previous;
  const summary = !totals.visits
    ? "No visits yet this week"
    : busiest && busiest.count === totals.visits
      ? `${totals.visits === 1 ? "On" : totals.visits === 2 ? "Both on" : `All ${totals.visits} on`} ${busiestText}`
      : `Busiest: ${busiestText}`;

  const tabs = (
    <div className="pa-tabs" role="tablist" aria-label="Choose a chart">
      {TABS.map(([id, name]) => (
        <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{name}</button>
      ))}
    </div>
  );

  const when = () => {
    const readout = pick
      ? `${weekday(days[pick.day], "long")}, ${span(pick.h, pick.h + 1)}: ${visitsWord(grid[pick.day][pick.h])}`
      : busiest ? `${busiestText} (${visitsWord(busiest.count)})` : "No visits this week";
    const slots = days.flatMap((date, d) => Array.from({ length: 24 }, (_, h) => ({
      d, h, now: grid[d]?.[h] ?? 0, before: previousGrid[d]?.[h] ?? 0, date,
    }))).filter((slot) => slot.now || slot.before);
    const listed = slots.slice(0, 40);
    const rest = { now: totals.visits - listed.reduce((a, s) => a + s.now, 0), before: totals.previous - listed.reduce((a, s) => a + s.before, 0) };
    return (
      <div className="pa-when">
        <div className="pa-card-head">
          <div><span className="pa-eyebrow">{pick ? "Selected hour" : "Busiest time"}</span><strong className="pa-readout">{readout}</strong></div>
          <button className="pa-ghost" aria-pressed={table} onClick={() => setTable((v) => !v)}>{table ? "Chart" : "Table"}</button>
        </div>
        {!table ? (
          <>
            <div className="pa-grid" role="grid" aria-label="Visits by day and hour">
              <div className="pa-grid-row pa-grid-days" role="row">
                <span />
                {days.map((date, d) => (
                  <span key={date} role="columnheader" className="pa-day">
                    <b className={dayTotals[d] ? "has" : ""}>{dayTotals[d]}</b>{weekday(date)}
                  </span>
                ))}
                <span />
              </div>
              {Array.from({ length: 24 }, (_, h) => (
                <div className="pa-grid-row" role="row" key={h}>
                  <span className="pa-hour">{h % 3 === 0 ? hour(h) : ""}</span>
                  {days.map((date, d) => {
                    const v = grid[d]?.[h] ?? 0;
                    const selected = pick?.day === d && pick.h === h;
                    return (
                      <button key={date} role="gridcell" className="pa-cell" aria-selected={selected}
                        aria-label={`${weekday(date, "long")}, ${span(h, h + 1)}: ${visitsWord(v)}`}
                        style={{ background: v ? RAMP[Math.min(4, Math.ceil((v / cellMax) * 5) - 1)] : EMPTY,
                          boxShadow: `0 0 0 2px ${selected ? "#23253F" : "transparent"}` }}
                        onClick={() => setPick({ day: d, h })} onFocus={() => setPick({ day: d, h })} />
                    );
                  })}
                  <span className="pa-hour-total">
                    {hourTotals[h] > 0 && <><span style={{ width: Math.round((hourTotals[h] / hourMax) * 16) }} />{hourTotals[h]}</>}
                  </span>
                </div>
              ))}
            </div>
            <div className="pa-legend">
              <span className="pa-swatch pa-none" />None
              <span className="pa-legend-gap">Fewer</span>
              <span className="pa-ramp">{RAMP.map((c) => <span key={c} style={{ background: c }} />)}</span>
              <span>More</span>
              <span className="pa-legend-hint">Tap a square</span>
            </div>
          </>
        ) : (
          <div className="pa-table" role="table">
            <div className="pa-trow pa-thead" role="row"><span>When</span><span>This wk</span><span>Prev wk</span></div>
            <div className="pa-tscroll">
              {listed.map((slot) => (
                <div className="pa-trow" role="row" key={`${slot.d}-${slot.h}`}>
                  <span>{weekday(slot.date)}, {span(slot.h, slot.h + 1)}</span><span>{slot.now}</span><span>{slot.before}</span>
                </div>
              ))}
              <div className="pa-trow is-muted" role="row"><span>All other hours</span><span>{Math.max(0, rest.now)}</span><span>{Math.max(0, rest.before)}</span></div>
            </div>
            <div className="pa-trow is-total" role="row"><span>Total</span><span>{totals.visits}</span><span>{totals.previous}</span></div>
          </div>
        )}
      </div>
    );
  };

  const where = () => {
    const zones = data.zones.filter((z) => z.visits > 0);
    const quiet = data.zones.filter((z) => z.visits === 0);
    const top = zones.length ? zones[0].visits : 0;
    const leaders = zones.filter((z) => z.visits === top);
    const readout = !zones.length ? "No zone visits yet"
      : leaders.length === 1 ? `${leaders[0].name}, ${visitsWord(top)}`
        : leaders.length === 2 ? `${leaders[0].name} and ${leaders[1].name}, ${visitsWord(top)} each`
          : `${leaders[0].name} and ${leaders.length - 1} more, ${visitsWord(top)} each`;
    const avg = duration(totals.avg_visit_s);
    const alerts = props.alerts;
    const open = alerts?.alerts.filter((a) => !a.acknowledged).length ?? 0;
    return (
      <div className="pa-stack">
        <div><span className="pa-eyebrow">Busiest zones</span><strong className="pa-readout">{readout}</strong></div>
        {zones.map((z) => {
          const share = totals.visits ? Math.round((z.visits / totals.visits) * 100) : 0;
          return (
            <div className="pa-bar-item" key={z.name}>
              <div className="pa-bar-label"><span>{z.name}</span><span><b>{z.visits}</b> <em>({share}%) {signed(z.visits - z.previous)}</em></span></div>
              <div className="pa-track"><span style={{ width: `${Math.min(100, share)}%` }} /></div>
            </div>
          );
        })}
        {quiet.length > 0 && (
          <>
            <button className="pa-toggle" aria-expanded={zonesOpen} onClick={() => setZonesOpen((v) => !v)}>
              <span>{quiet.length} {quiet.length === 1 ? "zone" : "zones"} with no visits</span><span className="pa-link">{zonesOpen ? "Hide" : "Show"}</span>
            </button>
            {zonesOpen && <div className="pa-chips">{quiet.map((z) => <span key={z.name}>{z.name}</span>)}</div>}
          </>
        )}
        <div className="pa-stat"><span>Avg. time per visit</span><b>{avg ?? "Not enough data yet"}</b></div>
        {alerts && props.onAlertSettings && props.onAcknowledge && (
          <>
            <button className="pa-toggle" aria-expanded={alertsOpen} onClick={() => setAlertsOpen((v) => !v)}>
              <span>Queue & crowding alerts{open ? <em className="pa-badge">{open} new</em> : null}</span>
              <span className="pa-link">{alerts.settings.enabled ? "On" : "Off"} · {alertsOpen ? "Hide" : "Show"}</span>
            </button>
            {alertsOpen && (
              <div className="pa-alerts">
                <AlertsCard alerts={alerts} busy={!!props.alertsBusy} onSettings={props.onAlertSettings} onAcknowledge={props.onAcknowledge} />
              </div>
            )}
          </>
        )}
      </div>
    );
  };

  const arrivals = () => {
    const entrances = data.entrances.filter((e) => e.visits > 0 || e.previous > 0);
    const lead = entrances[0];
    const readout = !lead || !lead.visits ? "No arrivals yet this week"
      : lead.visits === totals.visits
        ? `All ${visitsWord(totals.visits)} started at ${lead.name}`
        : `Most visits started at ${lead.name} (${lead.visits} of ${totals.visits})`;
    return (
      <div className="pa-stack">
        <div><span className="pa-eyebrow">Where visits started</span><strong className="pa-readout">{readout}</strong></div>
        {entrances.map((e) => {
          const share = totals.visits ? (e.visits / totals.visits) * 100 : 0;
          return (
            <div className="pa-bar-item" key={e.camera_id}>
              <div className="pa-bar-label"><span>{e.name}</span><span><b>{e.visits} of {totals.visits}</b> <em>{signed(e.visits - e.previous)}</em></span></div>
              <div className="pa-track"><span style={{ width: `${share}%` }} /></div>
            </div>
          );
        })}
        {entrances.length <= 1 && (
          <div className="pa-note">
            <Info size={16} aria-hidden="true" />
            <span>{entrances.length ? "Only one entrance camera is recording arrivals, so every visit starts here." : "Arrivals appear once your cameras record visits."} Pair a camera at each door to count every entrance.</span>
          </div>
        )}
        <button className="pa-primary" onClick={props.onPair}>Pair a camera</button>
      </div>
    );
  };

  const accuracy = () => {
    const q = data.quality;
    const total = q.tracked + q.positioned + q.estimated;
    const readout = !total ? "No visits to measure yet"
      : q.estimated ? `${q.estimated} of ${visitsWord(total)} ${q.estimated === 1 ? "is an estimate" : "are estimates"}`
        : `${q.tracked} of ${visitsWord(total)} followed by person detection`;
    const parts = [
      { label: "Followed by person detection", value: q.tracked, color: "#3A2FB0" },
      { label: "Positioned sightings", value: q.positioned, color: "#6D5FEA" },
      { label: "Estimated from camera view", value: q.estimated, color: "#A79EF4" },
    ];
    const state = props.insight;
    const note = state?.insight;
    const trendIcon = { up: TrendingUp, down: TrendingDown, flat: Minus, info: Info } as const;
    return (
      <div className="pa-stack">
        <div><span className="pa-eyebrow">How sure these numbers are</span><strong className="pa-readout">{readout}</strong></div>
        <div className="pa-stacked" aria-label={`Of ${visitsWord(total)}: ${q.tracked} followed, ${q.positioned} positioned, ${q.estimated} estimated`}>
          {total ? parts.filter((p) => p.value).map((p) => <span key={p.label} style={{ flexGrow: p.value, background: p.color }} />) : <span style={{ flexGrow: 1, background: EMPTY }} />}
        </div>
        <div className="pa-legend-rows">
          {parts.map((p) => <div key={p.label}><span><i style={{ background: p.color }} />{p.label}</span><b>{p.value}</b></div>)}
        </div>
        <p className="pa-fine">Positions are estimates, not calibrated measurements. No faces are identified.</p>
        {!state?.available ? (
          <div className="pa-note-link is-off">
            <span><b>Weekly notes are off</b><small>Add an Amazon Bedrock key on the server</small></span>
          </div>
        ) : note ? (
          <>
            <button className="pa-note-link" aria-expanded={noteOpen} onClick={() => setNoteOpen((v) => !v)}>
              <span><b><Sparkles size={14} aria-hidden="true" /> This week&rsquo;s note</b><small>{note.headline}</small></span>
              <svg className={noteOpen ? "is-open" : ""} width="9" height="14" viewBox="0 0 10 16" fill="none" stroke="#5B5E78" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M2 2l6 6-6 6" /></svg>
            </button>
            {noteOpen && (
              <div className="pa-insight" aria-busy={props.insightBusy}>
                <p>{note.summary}</p>
                <ul>{note.highlights.map((h) => {
                  const Icon = trendIcon[h.trend];
                  return <li key={h.title} className={`trend-${h.trend}`}><Icon size={15} aria-hidden="true" /><span><b>{h.title}</b>{h.detail}</span></li>;
                })}</ul>
                <p className="pa-insight-action"><b>Try this week:</b> {note.recommendation}</p>
                <div className="pa-insight-foot">
                  <small>Amazon Nova on Amazon Bedrock · aggregate counts only</small>
                  <button onClick={props.onInsight} disabled={props.insightBusy}><RefreshCw size={13} aria-hidden="true" />{props.insightBusy ? "Writing…" : "Refresh"}</button>
                </div>
              </div>
            )}
          </>
        ) : (
          <button className="pa-note-link" onClick={props.onInsight} disabled={props.insightBusy}>
            <span><b><Sparkles size={14} aria-hidden="true" /> {props.insightBusy ? "Writing this week’s note…" : "Write this week’s note"}</b><small>Amazon Bedrock explains what changed, from counts only</small></span>
          </button>
        )}
        {props.insightError && <p className="pa-error" role="alert">{props.insightError}</p>}
      </div>
    );
  };

  return (
    <div className="pa-page">
      {header}
      <div className={`pa-body${loading ? " is-refreshing" : ""}`}>
        <section className="pa-card pa-headline" aria-label="This week">
          <div className="pa-big"><span>{totals.visits}</span><small>{totals.visits === 1 ? "visit" : "visits"}</small></div>
          <div className="pa-headline-text">
            <span className="pa-delta">
              {change > 0 ? <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true"><path d="M5 1.5l4 6H1z" fill="#1E7A3C" /></svg>
                : change < 0 ? <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true"><path d="M5 8.5l4-6H1z" fill="#B4232C" /></svg> : null}
              {change ? <><b className={change > 0 ? "up" : "down"}>{signed(change)}</b> vs previous 7 days</> : "Same as previous 7 days"}
            </span>
            <span className="pa-summary">{summary}</span>
            {totals.visits > 0 && totals.visits < 10 && <span className="pa-sample">Small sample, patterns will change</span>}
          </div>
        </section>
        {tabs}
        <section className="pa-card pa-chart" role="tabpanel" aria-label={TABS.find(([id]) => id === tab)![1]}>
          {tab === "when" ? when() : tab === "where" ? where() : tab === "arrivals" ? arrivals() : accuracy()}
        </section>
      </div>
    </div>
  );
}

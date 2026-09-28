/**
 * Site Analytics dashboard, presentational only: the web page and the native
 * app's embedded view both render it with data they fetched themselves.
 *
 * Reading order: site and period, one hero figure (visits) with three stat
 * tiles, the weekly AI note, then the charts from "when" (days, hours, busy
 * times) to "where" (zones, entrances). Numbers on this page are estimates of
 * foot traffic from camera events, and the data-quality line says how many
 * visits come from detected paths.
 */
import { Building2, Clock3, DoorOpen, Info, Minus, RefreshCw, Sparkles, TrendingDown, TrendingUp } from "lucide-react";
import type { components } from "../generated";
import { ACCENT, BusyGrid, ChartCard, DailyCompare, HourlyColumns, PREVIOUS, RankedBars, hourLabel } from "./charts";
import AlertsCard, { type AlertSettingsInput, type CrowdAlerts } from "./AlertsCard";
import "./analytics.css";

export type SiteAnalytics = components["schemas"]["SiteAnalytics"];
export type SiteSummary = components["schemas"]["SiteAnalyticsSummary"];
export type InsightState = components["schemas"]["SiteInsightState"];
/** "live" counts only visits seen by Ring cameras; "all" adds simulated ones. */
export type AnalyticsMode = "all" | "live";

export type AnalyticsViewProps = {
  sites: SiteSummary[];
  siteId: string;
  onSite: (id: string) => void;
  data: SiteAnalytics | null;
  loading: boolean;
  error: string;
  insight: InsightState | null;
  insightBusy: boolean;
  insightError: string;
  onInsight: () => void;
  onRetry: () => void;
  /** Queue and crowding alerts; omitted until loaded. */
  alerts?: CrowdAlerts | null;
  alertsBusy?: boolean;
  onAlertSettings?: (next: AlertSettingsInput) => void;
  onAcknowledge?: (id: number) => void;
  /** Which visits the figures count; the switch shows only when simulated visits exist. */
  mode?: AnalyticsMode;
  onMode?: (mode: AnalyticsMode) => void;
};

const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;

/** Says plainly how many of the figures are simulated, or that they are hidden. */
export function simulatedNote(data: SiteAnalytics | null, mode: AnalyticsMode = "all"): string | null {
  const count = data?.simulated_visits ?? 0;
  if (mode === "live")
    return `Live only: visits seen by your Ring cameras.${count ? ` ${plural(count, "simulated visit")} hidden.` : ""}`;
  return null;
}

/** All data / Live only, shown when the week has simulated visits (or live is already chosen). */
export function ModeSwitch({ data, mode = "all", onMode, className = "an-mode" }: {
  data: SiteAnalytics | null; mode?: AnalyticsMode; onMode?: (mode: AnalyticsMode) => void; className?: string;
}) {
  if (!onMode || (!data?.simulated_visits && mode !== "live")) return null;
  return (
    <div className={className} role="group" aria-label="Which visits to count">
      <button type="button" aria-pressed={mode !== "live"} onClick={() => onMode("all")}>All data</button>
      <button type="button" aria-pressed={mode === "live"} onClick={() => onMode("live")}>Live only</button>
    </div>
  );
}

const weekday = (date: string, style: "short" | "long" = "short") =>
  new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: style });
const dayLabel = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const duration = (seconds: number | null | undefined) => {
  if (seconds == null) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60), s = Math.round(seconds % 60);
  return s ? `${m}m ${s}s` : `${m}m`;
};

function Delta({ now, before, unit = "", invert = false }: { now: number | null | undefined; before: number | null | undefined; unit?: string; invert?: boolean }) {
  if (now == null || !before) return <span className="an-delta">{before === 0 && now ? "New this week" : "No comparison yet"}</span>;
  const pct = Math.round(((now - before) / before) * 100);
  const good = invert ? pct < 0 : pct > 0;
  const Icon = pct > 0 ? TrendingUp : pct < 0 ? TrendingDown : Minus;
  return (
    <span className={`an-delta ${pct === 0 ? "" : good ? "good" : "bad"}`}>
      <Icon size={14} aria-hidden="true" />{pct > 0 ? "+" : ""}{pct}%{unit} vs last week
    </span>
  );
}

function SiteSwitcher({ sites, siteId, onSite }: Pick<AnalyticsViewProps, "sites" | "siteId" | "onSite">) {
  if (sites.length <= 1) {
    const site = sites[0];
    return site ? <div className="an-site-single"><Building2 size={16} aria-hidden="true" />{site.name}</div> : null;
  }
  return (
    <div className="an-sites" role="tablist" aria-label="Sites">
      {sites.map((site) => (
        <button key={site.site_id} role="tab" aria-selected={site.site_id === siteId} onClick={() => onSite(site.site_id)}>
          <span>{site.name}</span>
          <small>{site.visits} visits{site.change_pct != null ? ` · ${site.change_pct > 0 ? "+" : ""}${Math.round(site.change_pct)}%` : ""}</small>
        </button>
      ))}
    </div>
  );
}

function InsightCard({ insight, busy, error, onInsight, visits }: {
  insight: InsightState | null; busy: boolean; error: string; onInsight: () => void; visits: number;
}) {
  const data = insight?.insight;
  const trendIcon = { up: TrendingUp, down: TrendingDown, flat: Minus, info: Info } as const;
  return (
    <section className={`an-insight${busy ? " is-busy" : ""}`} aria-labelledby="an-insight-title" aria-busy={busy}>
      <header>
        <span className="an-insight-badge"><Sparkles size={15} aria-hidden="true" />Weekly insight</span>
        {insight?.available && data && (
          <button type="button" className="an-insight-refresh" onClick={onInsight} disabled={busy} aria-label="Refresh weekly insight">
            <RefreshCw size={15} aria-hidden="true" />{busy ? "Writing…" : "Refresh"}
          </button>
        )}
      </header>
      {data ? (
        <>
          <h3 id="an-insight-title">{data.headline}</h3>
          <p className="an-insight-summary">{data.summary}</p>
          {data.highlights.length > 0 && (
            <ul className="an-insight-points">
              {data.highlights.map((item) => {
                const Icon = trendIcon[item.trend];
                return (
                  <li key={item.title} className={`trend-${item.trend}`}>
                    <Icon size={16} aria-hidden="true" />
                    <span><strong>{item.title}</strong>{item.detail}</span>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="an-insight-action"><strong>Try this week:</strong> {data.recommendation}</p>
          <footer>
            Written by {data.model.includes("nova") ? "Amazon Nova" : data.model} on {data.provider} from aggregate counts only ·{" "}
            {new Date(data.generated_at).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}
          </footer>
        </>
      ) : (
        <div className="an-insight-empty">
          <h3 id="an-insight-title">{!insight?.available ? "AI insights aren’t set up on this server" : busy ? "Writing this week’s insight…" : "Get a plain-English summary of your week"}</h3>
          <p>{!insight?.available
            ? "Add an Amazon Bedrock key on the server to turn these charts into a weekly note."
            : visits
              ? "Amazon Bedrock reads the numbers below (never video or images) and explains what changed."
              : "Once visits start coming in, your weekly note will explain what changed and what to try."}</p>
          {insight?.available && !busy && (
            <button type="button" className="an-primary" onClick={onInsight}><Sparkles size={16} aria-hidden="true" />Write this week’s insight</button>
          )}
        </div>
      )}
      {error && <p className="an-error" role="alert">{error}</p>}
    </section>
  );
}

export default function AnalyticsView(props: AnalyticsViewProps) {
  const { data, loading, error } = props;
  const totals = data?.totals;
  const today = data?.daily[data.daily.length - 1]?.date;
  const days = (data?.daily ?? []).map((d) => ({ label: weekday(d.date), visits: d.visits, previous: d.previous, today: d.date === today }));
  const zones = data?.zones ?? [];
  const quietest = totals?.quietest_zone ?? null;
  const q = data?.quality;
  const qualityTotal = q ? q.tracked + q.positioned + q.estimated : 0;

  return (
    <div className="an-page">
      <div className="an-toolbar">
        <div className="an-title">
          <h2>Site Analytics</h2>
          <p>{data ? `Last 7 days (${dayLabel(data.daily[0].date)} – ${dayLabel(data.daily[6].date)}) vs the 7 days before · ${data.time_zone.replace("_", " ")}` : "Foot traffic from your Ring cameras"}</p>
        </div>
        <div className="an-toolbar-controls">
          <ModeSwitch data={data} mode={props.mode} onMode={props.onMode} />
          <SiteSwitcher sites={props.sites} siteId={props.siteId} onSite={props.onSite} />
        </div>
      </div>
      {simulatedNote(data, props.mode) && (
        <p className={`an-sim-note${props.mode === "live" ? " is-live" : ""}`} role="note">
          <Info size={14} aria-hidden="true" />{simulatedNote(data, props.mode)}
        </p>
      )}

      {error && !data && (
        <div className="an-card an-message" role="alert">
          <p>{error}</p>
          <button type="button" className="an-primary" onClick={props.onRetry}>Try again</button>
        </div>
      )}
      {!data && loading && <div className="an-card an-message" role="status"><p>Loading analytics…</p></div>}

      {data && totals && (
        <div className={`an-body${loading ? " is-refreshing" : ""}`}>
          <div className="an-kpis">
            <article className="an-hero">
              <span className="an-kpi-label">Visits</span>
              <strong className="an-hero-value">{totals.visits.toLocaleString()}</strong>
              <Delta now={totals.visits} before={totals.previous} />
              <span className="an-kpi-note">{totals.previous.toLocaleString()} the week before</span>
            </article>
            <article className="an-kpi">
              <span className="an-kpi-label"><Clock3 size={15} aria-hidden="true" />Peak hour</span>
              <strong>{totals.peak_hour != null ? hourLabel(totals.peak_hour) : "—"}</strong>
              <span className="an-kpi-note">{totals.peak_hour != null ? `${totals.peak_hour_visits} visits in that hour this week` : "No visits yet"}</span>
            </article>
            <article className="an-kpi">
              <span className="an-kpi-label">Busiest zone</span>
              <strong title={totals.busiest_zone ?? undefined}>{totals.busiest_zone ?? "—"}</strong>
              <span className="an-kpi-note">{quietest && quietest !== totals.busiest_zone ? `Quietest: ${quietest}` : "Zones come from your floor plan"}</span>
            </article>
            <article className="an-kpi">
              <span className="an-kpi-label">Avg. visit length</span>
              <strong>{duration(totals.avg_visit_s)}</strong>
              <Delta now={totals.avg_visit_s} before={totals.avg_visit_previous_s} />
            </article>
          </div>

          <InsightCard insight={props.insight} busy={props.insightBusy} error={props.insightError}
            onInsight={props.onInsight} visits={totals.visits} />

          {props.alerts && props.onAlertSettings && props.onAcknowledge && (
            <AlertsCard alerts={props.alerts} busy={!!props.alertsBusy}
              onSettings={props.onAlertSettings} onAcknowledge={props.onAcknowledge} />
          )}

          <div className="an-grid">
            <ChartCard className="an-span" title="Visits per day" subtitle="This week against the same day last week"
              legend={[{ label: "This week", color: ACCENT }, { label: "Last week", color: PREVIOUS }]}
              table={{ head: ["Day", "This week", "Last week"], rows: data.daily.map((d) => [`${weekday(d.date, "long")} ${dayLabel(d.date)}`, d.visits, d.previous]) }}>
              <DailyCompare days={days} />
            </ChartCard>

            <ChartCard title="Visits by hour"
              subtitle={totals.peak_hour != null ? <>Busiest at <strong>{hourLabel(totals.peak_hour)}</strong>{totals.first_hour != null && totals.last_hour != null ? ` · activity from ${hourLabel(totals.first_hour)} to ${hourLabel(totals.last_hour)}` : ""}</> : "No visits this week yet"}
              table={{ head: ["Hour", "This week", "Last week"], rows: data.hourly.filter((h) => h.visits || h.previous).map((h) => [hourLabel(h.hour), h.visits, h.previous]) }}>
              <HourlyColumns hours={data.hourly} peak={totals.peak_hour ?? null} />
            </ChartCard>

            <ChartCard title="Busy times" subtitle="Each square is one hour; darker is busier"
              table={{ head: ["Day", "Busiest hour", "Visits"], rows: data.daily.map((d, i) => {
                const row = data.week_grid[i] ?? [];
                const top = row.reduce((best, v, h) => (v > row[best] ? h : best), 0);
                return [`${weekday(d.date, "long")} ${dayLabel(d.date)}`, row[top] ? hourLabel(top) : "—", row.reduce((a, b) => a + b, 0)];
              }) }}>
              <BusyGrid rows={data.daily.map((d, i) => ({ label: weekday(d.date), counts: data.week_grid[i] ?? Array(24).fill(0) }))} />
            </ChartCard>

            <ChartCard title="Zones" subtitle="Visits that passed through each area, with average time spent"
              table={{ head: ["Zone", "Visits", "Last week", "Avg. time"], rows: zones.map((z) => [z.name, z.visits, z.previous, duration(z.dwell_s)]) }}>
              <RankedBars quietest={quietest} emptyLabel="Add rooms or zones to your floor plan to see them here."
                items={zones.map((z) => ({ name: z.name, value: z.visits, previous: z.previous,
                  note: z.dwell_s != null ? `Avg. ${duration(z.dwell_s)} here` : undefined }))} />
            </ChartCard>

            <ChartCard title="Entrances" subtitle="Where visits started, by the first camera to see them"
              table={{ head: ["Camera", "Visits", "Last week"], rows: data.entrances.map((e) => [e.name, e.visits, e.previous]) }}>
              <RankedBars emptyLabel="Entrance counts appear after your cameras record visits."
                items={data.entrances.map((e) => ({ name: e.name, value: e.visits, previous: e.previous }))} />
              <p className="an-footnote"><DoorOpen size={14} aria-hidden="true" />Pair a camera at each door to count every entrance.</p>
            </ChartCard>
          </div>

          <p className="an-quality">
            <Info size={14} aria-hidden="true" />
            {qualityTotal
              ? `Of ${qualityTotal} visits this week, ${q!.tracked} were followed by person detection, ${q!.positioned} had positioned sightings and ${q!.estimated} are estimates from the camera’s view.`
              : "Visits appear here as your Ring cameras record activity."}{" "}
            Positions are estimates, not calibrated measurements. No faces are identified.
          </p>
        </div>
      )}
    </div>
  );
}

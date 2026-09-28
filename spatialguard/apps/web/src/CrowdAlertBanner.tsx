import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Users, X } from "lucide-react";
import { alertDetail, alertTitle, type CrowdAlerts } from "./analytics/AlertsCard";
import { request } from "./platform";

type Alert = CrowdAlerts["alerts"][number];
const FRESH_MS = 30 * 60 * 1000;

/**
 * The live queue/crowding alert, shown across the whole app the moment the
 * server raises one (it arrives as an `alert.crowding` site event). Also a
 * browser notification when the owner has allowed them.
 */
export function useCrowdAlert(siteId: string | undefined) {
  const [alert, setAlert] = useState<Alert | null>(null);
  const seen = useRef(new Set<number>());
  const first = useRef(true);
  const load = useCallback(async () => {
    if (!siteId) return;
    try {
      const body = await request<CrowdAlerts>(`/v1/sites/${siteId}/alerts`);
      const open = body.alerts.find((a) => !a.acknowledged && Date.now() - Date.parse(a.at) < FRESH_MS) ?? null;
      setAlert(open);
      if (open && !seen.current.has(open.id)) {
        seen.current.add(open.id);
        // Only ping for alerts that arrive while the app is open, not old ones on load.
        if (!first.current && "Notification" in window && Notification.permission === "granted")
          new Notification(alertTitle(open), { body: alertDetail(open), tag: `crowd-${open.id}` });
      }
      first.current = false;
    } catch {
      // A missed alert check is retried with the next activity.
    }
  }, [siteId]);
  useEffect(() => {
    first.current = true;
    setAlert(null);
    void load();
  }, [load]);
  const dismiss = useCallback(async () => {
    if (!siteId || !alert) return;
    setAlert(null);
    await request(`/v1/sites/${siteId}/alerts/${alert.id}/acknowledge`, "POST").catch(() => undefined);
  }, [siteId, alert]);
  return { alert, reload: load, dismiss };
}

export default function CrowdAlertBanner({ alert, onView, onDismiss }: {
  alert: Alert | null;
  onView: () => void;
  onDismiss: () => void;
}) {
  if (!alert) return null;
  return (
    <div className={`crowd-banner crowd-banner-${alert.kind}`} role="status" aria-live="polite">
      <span className="crowd-banner-icon" aria-hidden="true">{alert.kind === "queue" ? <Users size={18} /> : <AlertTriangle size={18} />}</span>
      <span className="crowd-banner-copy">
        <strong>{alertTitle(alert)}</strong>
        <small>{alertDetail(alert)} · limit {alert.limit}</small>
      </span>
      <button type="button" className="crowd-banner-view" onClick={onView} aria-label="View alert in Site Analytics">View</button>
      <button type="button" className="crowd-banner-dismiss" onClick={onDismiss} aria-label="Got it, dismiss alert"><X size={18} /></button>
    </div>
  );
}

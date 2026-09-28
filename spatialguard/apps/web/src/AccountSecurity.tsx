import { useEffect, useState } from "react";
import { Bell, Download, KeyRound, ListChecks, ShieldCheck, UserRound } from "lucide-react";
import { request } from "./platform";

type AccessRecord = { id: number; actor: string; action: string; device: string; purpose: string; result: string; at: string };
type NotificationPreferences = { incident_email: boolean; operational_email: boolean; weekly_summary: boolean; marketing: boolean };
type Delivery = { event_type: string; request_id: string; received_at: string; state: string; attempts: number; failure: string | null };
type NotificationRecord = { category: string; channel: string; state: string; detail: string; at: string };
type Row = { title: string; meta: string; status?: string; bad?: boolean };

/** "live_view.start" → "Live view start". */
const human = (value: string) => {
  const text = value.replace(/[._]+/g, " ").trim().toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
};
const when = (value: string) =>
  new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const failed = (state: string) => /fail|denied|error|reject/i.test(state);

const EMAILS = [
  ["incident_email", "Incidents", "An email when new activity is recorded."],
  ["operational_email", "Camera status", "When a camera goes offline or comes back."],
  ["weekly_summary", "Weekly summary", "A short recap every week."],
  ["marketing", "Product news", "New features and tips."],
] as const;

export default function AccountSecurity({ onSessionsChanged, ringDataConsent }: { onSessionsChanged: () => void; ringDataConsent: boolean }) {
  const [access, setAccess] = useState<AccessRecord[]>([]);
  const [notifications, setNotifications] = useState<NotificationPreferences | null>(null);
  const [saved, setSaved] = useState<NotificationPreferences | null>(null);
  const [verification, setVerification] = useState<{ email: string | null; verified: boolean } | null>(null);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [notificationHistory, setNotificationHistory] = useState<NotificationRecord[]>([]);
  const [securityActivity, setSecurityActivity] = useState<{ action: string; at: string }[]>([]);
  const [currentPassword, setCurrentPassword] = useState(""), [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState(""), [notice, setNotice] = useState("");
  const [log, setLog] = useState<"Security" | "Ring access" | "Ring events" | "Emails">("Security");
  useEffect(() => {
    void Promise.all([
      request<AccessRecord[]>("/v1/account/access-log").then(setAccess),
      request<NotificationPreferences>("/v1/account/notifications").then((value) => { setNotifications(value); setSaved(value); }),
      request<{ email: string | null; verified: boolean }>("/v1/account/verification").then(setVerification),
      request<NotificationRecord[]>("/v1/account/notification-history").then(setNotificationHistory),
      request<{ action: string; at: string }[]>("/v1/account/security-activity").then(setSecurityActivity),
      ...(ringDataConsent ? [request<Delivery[]>("/v1/ring/event-deliveries").then(setDeliveries)] : []),
    ]);
  }, [ringDataConsent]);

  const downloadExport = async () => {
    const data = await request<object>("/v1/account/export");
    const href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = href; link.download = "spatialguard-account-export.json"; link.click(); URL.revokeObjectURL(href);
  };
  const changePassword = () =>
    void request<{ message: string }>("/v1/account/password", "POST", { current_password: currentPassword, new_password: newPassword })
      .then((result) => { setMessage(result.message); setCurrentPassword(""); setNewPassword(""); onSessionsChanged(); })
      .catch((error: Error) => setMessage(error.message));

  const logs: Record<typeof log, Row[]> = {
    Security: securityActivity.slice(0, 10).map((item) => ({ title: human(item.action), meta: when(item.at) })),
    "Ring access": access.slice(0, 20).map((item) => ({ title: human(item.action), meta: `${item.device} · ${when(item.at)}`, status: human(item.result), bad: failed(item.result) })),
    "Ring events": deliveries.slice(0, 20).map((item) => ({ title: human(item.event_type), meta: when(item.received_at), status: human(item.state), bad: failed(item.state) || !!item.failure })),
    Emails: notificationHistory.slice(0, 10).map((item) => ({ title: human(item.category), meta: `${item.detail} · ${when(item.at)}`, status: human(item.state), bad: failed(item.state) })),
  };
  const tabs = (Object.keys(logs) as (typeof log)[]).filter((name) => name !== "Ring events" || ringDataConsent);
  const changed = notifications && saved && EMAILS.some(([key]) => notifications[key] !== saved[key]);

  return <div className="security-page">
    <section className="settings-card">
      <h2><UserRound size={19} /> Account</h2>
      {verification && <div className="settings-row">
        <span><strong>{verification.email}</strong><small>Sign-in email</small></span>
        {verification.verified
          ? <em className="status-pill ok">Verified</em>
          : <button onClick={() => void request<{ message: string }>("/v1/account/verification/request", "POST").then((result) => setNotice(result.message))}>Verify email</button>}
      </div>}
      {notice && <p className="fine" role="status">{notice}</p>}
    </section>

    <section className="settings-card">
      <h2><KeyRound size={19} /> Password</h2>
      <div className="settings-fields">
        <label>Current password<input type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} /></label>
        <label>New password<input type="password" autoComplete="new-password" minLength={8} value={newPassword} placeholder="At least 8 characters" onChange={(e) => setNewPassword(e.target.value)} /></label>
      </div>
      <div className="button-row">
        <button className="primary" disabled={currentPassword.length < 8 || newPassword.length < 8} onClick={changePassword}>Change password</button>
        <button onClick={() => void request("/v1/sessions/revoke-all", "POST").then(() => { setMessage("Other devices signed out."); onSessionsChanged(); })}>Sign out other devices</button>
      </div>
      {message && <p className="fine" role="status">{message}</p>}
    </section>

    {notifications && <section className="settings-card">
      <h2><Bell size={19} /> Email notifications</h2>
      <div className="toggle-list">
        {EMAILS.map(([key, label, detail]) => (
          <label key={key} className="toggle-row">
            <span><strong>{label}</strong><small>{detail}</small></span>
            <input type="checkbox" role="switch" checked={notifications[key]} onChange={(e) => setNotifications({ ...notifications, [key]: e.target.checked })} />
          </label>
        ))}
      </div>
      <div className="button-row">
        <button className="primary" disabled={!changed} onClick={() => void request<NotificationPreferences>("/v1/account/notifications", "PUT", notifications).then((value) => { setNotifications(value); setSaved(value); })}>
          {changed ? "Save changes" : "Saved"}
        </button>
      </div>
    </section>}

    <section className="settings-card">
      <h2><ListChecks size={19} /> Activity</h2>
      <div className="view-toggle activity-tabs" role="tablist" aria-label="Activity log">
        {tabs.map((name) => <button key={name} role="tab" aria-selected={log === name} aria-pressed={log === name} onClick={() => setLog(name)}>{name}</button>)}
      </div>
      {logs[log].length ? (
        <ol className="activity-list">
          {logs[log].map((row, index) => (
            <li key={`${row.title}-${index}`}>
              <span><strong>{row.title}</strong><small>{row.meta}</small></span>
              {row.status && <em className={row.bad ? "status-pill bad" : "status-pill"}>{row.status}</em>}
            </li>
          ))}
        </ol>
      ) : <p className="activity-empty">Nothing here yet.</p>}
    </section>

    <section className="settings-card">
      <h2><ShieldCheck size={19} /> Your data</h2>
      <ul className="data-facts">
        <li>Live video is never recorded by Pathlight.</li>
        <li>Snapshots used for activity labels aren’t stored.</li>
        <li>You can download or delete your data anytime.</li>
      </ul>
      <div className="button-row">
        <button className="primary" onClick={() => void downloadExport()}><Download size={16} /> Download my data</button>
      </div>
    </section>
  </div>;
}

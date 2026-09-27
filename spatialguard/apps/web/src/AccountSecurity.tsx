import { useEffect, useState } from "react";
import { Download, KeyRound, ShieldCheck } from "lucide-react";
import { request } from "./platform";

type AccessRecord = { id: number; actor: string; action: string; device: string; purpose: string; result: string; at: string };
type NotificationPreferences = { incident_email: boolean; operational_email: boolean; weekly_summary: boolean; marketing: boolean };

type Delivery = { event_type: string; request_id: string; received_at: string; state: string; attempts: number; failure: string | null };
type NotificationRecord = { category: string; channel: string; state: string; detail: string; at: string };
export default function AccountSecurity({ onSessionsChanged, ringDataConsent }: { onSessionsChanged: () => void; ringDataConsent: boolean }) {
  const [access, setAccess] = useState<AccessRecord[]>([]);
  const [notifications, setNotifications] = useState<NotificationPreferences | null>(null);
  const [verification, setVerification] = useState<{email:string|null;verified:boolean}|null>(null);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [notificationHistory, setNotificationHistory] = useState<NotificationRecord[]>([]);
  const [securityActivity, setSecurityActivity] = useState<{action:string;at:string}[]>([]);
  const [currentPassword, setCurrentPassword] = useState(""), [newPassword, setNewPassword] = useState(""), [message, setMessage] = useState("");
  useEffect(() => { void Promise.all([
    request<AccessRecord[]>("/v1/account/access-log").then(setAccess),
    request<NotificationPreferences>("/v1/account/notifications").then(setNotifications),
    request<{email:string|null;verified:boolean}>("/v1/account/verification").then(setVerification),
    request<NotificationRecord[]>("/v1/account/notification-history").then(setNotificationHistory),
    request<{action:string;at:string}[]>("/v1/account/security-activity").then(setSecurityActivity),
    ...(ringDataConsent ? [request<Delivery[]>("/v1/ring/event-deliveries").then(setDeliveries)] : []),
  ]); }, [ringDataConsent]);

  const downloadExport = async () => {
    const data = await request<object>("/v1/account/export");
    const href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = href; link.download = "spatialguard-account-export.json"; link.click(); URL.revokeObjectURL(href);
  };
  return <>
    <section>
      <h2><ShieldCheck size={19} /> Account security</h2>
      {verification && <div className={verification.verified ? "account-verification verified" : "account-verification"}>
        <span><strong>{verification.verified ? "Email verified" : "Email verification needed"}</strong><small>{verification.email}</small></span>
        {!verification.verified && <button onClick={() => void request<{message:string}>("/v1/account/verification/request", "POST").then(result => setMessage(result.message))}>Send verification email</button>}
      </div>}
      <p>Change your password or sign out other devices.</p>
      <div className="settings-form-grid">
        <label>Current password<input type="password" autoComplete="current-password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} /></label>
        <label>New password<input type="password" autoComplete="new-password" minLength={8} value={newPassword} onChange={e => setNewPassword(e.target.value)} /></label>
      </div>
      <div className="button-row"><button className="primary" disabled={currentPassword.length < 8 || newPassword.length < 8} onClick={() => void request<{message:string}>("/v1/account/password", "POST", { current_password: currentPassword, new_password: newPassword }).then(result => { setMessage(result.message); setCurrentPassword(""); setNewPassword(""); onSessionsChanged(); })}><KeyRound size={16} /> Change password</button>
        <button onClick={() => void request("/v1/sessions/revoke-all", "POST").then(() => { setMessage("Other devices signed out."); onSessionsChanged(); })}>Sign out other devices</button></div>
      {message && <p className="fine" role="status">{message}</p>}
      <h3>Recent security activity</h3>{securityActivity.length ? <ol className="access-history">{securityActivity.slice(0, 10).map((item, index) => <li key={`${item.at}-${index}`}><strong>{item.action.replaceAll(".", " ")}</strong><span>{new Date(item.at).toLocaleString()}</span></li>)}</ol> : <p className="fine">No recent account security changes.</p>}
    </section>
    {notifications && <section><h2>Notifications</h2><p>Choose which emails you get.</p>
      <div className="settings-checks">{([
        ["incident_email", "Incident email"], ["operational_email", "Operational email"], ["weekly_summary", "Weekly summary"], ["marketing", "Product news and marketing"],
      ] as const).map(([key, label]) => <label key={key}><input type="checkbox" checked={notifications[key]} onChange={e => setNotifications({ ...notifications, [key]: e.target.checked })} /> {label}</label>)}</div>
      <button className="primary" onClick={() => void request<NotificationPreferences>("/v1/account/notifications", "PUT", notifications).then(setNotifications)}>Save notification choices</button>
      <h3>Delivery history</h3>{notificationHistory.length ? <ol className="access-history">{notificationHistory.slice(0, 10).map((item, index) => <li key={`${item.at}-${index}`}><strong>{item.category}</strong><span>{item.state} · {item.channel}</span><small>{item.detail} · {new Date(item.at).toLocaleString()}</small></li>)}</ol> : <p className="fine">No messages sent yet.</p>}
    </section>}
    <section><h2>Ring data access history</h2><p>Recent access to your Ring data.</p>
      {access.length ? <ol className="access-history">{access.slice(0, 20).map(item => <li key={item.id}><strong>{item.action.replaceAll(".", " ")}</strong><span>{item.device} · {new Date(item.at).toLocaleString()}</span><small>{item.purpose} · {item.result}</small></li>)}</ol> : <p className="fine">No Ring access yet.</p>}
    </section>
    <section><h2>Your data</h2><p>Download a copy of your data.</p><button className="primary" onClick={() => void downloadExport()}><Download size={16} /> Download JSON export</button></section>
    {ringDataConsent && <section><h2>Ring event delivery</h2><p>Recent Ring events received.</p>
      {deliveries.length ? <ol className="access-history">{deliveries.slice(0, 20).map((item, index) => <li key={`${item.request_id}-${index}`}><strong>{item.event_type.replaceAll("_", " ")}</strong><span>{item.state} · {new Date(item.received_at).toLocaleString()}</span><small>Request {item.request_id || "legacy"} · {item.attempts} attempt{item.attempts === 1 ? "" : "s"}{item.failure ? ` · ${item.failure}` : ""}</small></li>)}</ol> : <p className="fine">No Ring events yet.</p>}
    </section>}
  </>;
}

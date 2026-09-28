import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, View } from "react-native";
import { request, type Site, type Device } from "./api";
import { Button, Card, CardHeader, Chip, Icon, Label, styles as s, colors } from "./ui";

export function RingSettings({
  sites,
  devices,
  consent,
  enable,
  refresh,
}: {
  sites: Site[];
  devices: Device[];
  consent: boolean;
  enable: () => Promise<unknown>;
  refresh: () => Promise<unknown>;
}) {
  const [message, setMessage] = useState("");
  const run = async (fn: () => Promise<unknown>, done = "") => {
    try {
      await fn();
      setMessage(done);
    } catch (e) {
      setMessage((e as Error).message);
    }
  };
  return (
    <>
      <Card>
        <CardHeader
          title="Ring connection"
          action={<Chip text={devices.length ? "Connected" : consent ? "Not linked" : "Off"} tone={devices.length ? "success" : "muted"} />}
        />
        {!consent ? (
          <>
            <Label style={s.muted}>Pathlight needs your permission to use your Ring cameras.</Label>
            <Button title="Allow Ring access" onPress={() => void run(enable)} />
          </>
        ) : devices.length ? (
          <Button variant="secondary" icon="refresh" title="Refresh cameras" onPress={() => void run(refresh, "Cameras updated")} />
        ) : (
          <>
            <Label style={s.muted}>In the Ring app, find Pathlight and choose the cameras to share. Then come back here.</Label>
            <Button
              title="Get linking code"
              onPress={() =>
                void run(async () => {
                  const r = await request<{ code: string }>("/v1/ring/sign-in-code", "POST");
                  Alert.alert("Ring linking code", r.code);
                })
              }
            />
            <Button variant="secondary" icon="refresh" title="Refresh cameras" onPress={() => void run(refresh, "Cameras updated")} />
          </>
        )}
        {!!message && <Label style={[s.muted, { fontSize: 13 }]}>{message}</Label>}
      </Card>
      {devices.map((d) => (
        <Card key={d.id}>
          <View style={s.row}>
            <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: colors.purpleSoft, alignItems: "center", justifyContent: "center" }}>
              <Icon name="camera" size={20} color={colors.purple} />
            </View>
            <View style={{ flex: 1 }}>
              <Label style={s.strong}>{d.name}</Label>
              <Label style={[s.muted, { fontSize: 13 }]}>
                {d.support?.live_view === false ? "Not compatible" : d.camera_id ? "Paired" : "Not paired"}
              </Label>
            </View>
          </View>
          <Label style={[s.muted, { fontSize: 12, fontFamily: "SourceSansBold" }]}>PAIR WITH</Label>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {sites.flatMap((site) =>
              (site.layout.cameras ?? []).map((c) => {
                const on = d.site_id === site.id && d.camera_id === c.id;
                return (
                  <Pressable
                    key={site.id + c.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    onPress={() =>
                      void run(async () => {
                        await request(`/v1/ring/devices/${encodeURIComponent(d.id)}/mapping`, "PUT", { site_id: site.id, camera_id: c.id });
                        await refresh();
                      }, "Paired")
                    }
                    style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: on ? colors.purple : colors.border, backgroundColor: on ? colors.purple : colors.card }}
                  >
                    <Label style={{ fontSize: 14, fontFamily: "SourceSansBold", color: on ? "#fff" : colors.ink }}>
                      {sites.length > 1 ? `${site.name} · ` : ""}{c.name}
                    </Label>
                  </Pressable>
                );
              }),
            )}
          </View>
        </Card>
      ))}
    </>
  );
}

type OperationsData = {
  devices: {
    id: string;
    name: string;
    online: boolean;
    uptime_percent: number | null;
    checked_at: string;
  }[];
  alerts: { id: string; device: string; kind: string; at: number }[];
  projects: {
    id: string;
    name: string;
    frame_count: number;
    cadence_minutes: number;
  }[];
};
export function Operations() {
  const [data, setData] = useState<OperationsData | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    request<OperationsData>("/v1/ring/operations")
      .then((v) => {
        if (active) setData(v);
      })
      .catch((e) => {
        // Ring not linked or not allowed yet is the empty state, not an error.
        if (active) (e?.status && [403, 404, 409].includes(e.status) ? setData({ devices: [], alerts: [], projects: [] }) : setError(e.message));
      });
    return () => {
      active = false;
    };
  }, []);
  if (error)
    return (
      <Card style={{ borderColor: "#f3c4c9", backgroundColor: "#fff4f5" }}>
        <Label style={{ color: "#7c1d26" }}>{error}</Label>
      </Card>
    );
  if (!data) return <ActivityIndicator color={colors.purple} style={{ marginTop: 24 }} />;
  const online = data.devices.filter((d) => d.online).length;
  return (
    <>
      <Card style={{ gap: 0 }}>
        <View style={{ paddingBottom: 8 }}>
          <CardHeader title="Camera health" detail="Last 7 days" action={<Chip text={`${online}/${data.devices.length} online`} />} />
        </View>
        {data.devices.map((d) => (
          <View key={d.id} style={[s.row, { paddingVertical: 12, borderTopWidth: 1, borderColor: colors.line }]}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: d.online ? "#22a05b" : colors.danger }} />
            <View style={{ flex: 1 }}>
              <Label style={s.strong}>{d.name}</Label>
              <Label style={[s.muted, { fontSize: 13 }]}>
                {d.uptime_percent === null ? "No history yet" : `${d.uptime_percent}% uptime`}
              </Label>
            </View>
            <Chip text={d.online ? "Online" : "Offline"} tone={d.online ? "success" : "danger"} />
          </View>
        ))}
        {!data.devices.length && (
          <View style={{ alignItems: "center", paddingVertical: 20, gap: 6 }}>
            <Icon name="camera" size={22} color={colors.muted} />
            <Label style={s.strong}>No Ring cameras connected</Label>
            <Label style={s.muted}>Link Ring in Settings to see your cameras here.</Label>
          </View>
        )}
      </Card>
      <Card>
        <CardHeader title="Recent status alerts" />
        {data.alerts.map((a) => (
          <Label key={a.id} style={{ fontSize: 14 }}>
            {data.devices.find((d) => d.id === a.device)?.name || "Camera"} · {a.kind} · {new Date(a.at * 1000).toLocaleString()}
          </Label>
        ))}
        {!data.alerts.length && <Label style={s.muted}>No status changes recorded.</Label>}
      </Card>
      {!!data.projects.length && (
        <Card>
          <CardHeader title="Time-lapse" />
          {data.projects.map((p) => (
            <View key={p.id}>
              <Label style={s.strong}>{p.name}</Label>
              <Label style={[s.muted, { fontSize: 13 }]}>{p.frame_count} frames · every {p.cadence_minutes} min</Label>
            </View>
          ))}
        </Card>
      )}
    </>
  );
}

type DemoStatus = { simulated_visits: number; live_visits: number; rush_active: boolean; simulated_camera_ids: string[] };

/** Demo mode: simulated café customers for the product video (allowlisted accounts only). */
export function DemoSettings({ siteId, siteName }: { siteId?: string; siteName?: string }) {
  const [status, setStatus] = useState<DemoStatus | null>(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const load = async () => {
    if (!siteId) return;
    try {
      setStatus(await request<DemoStatus>(`/v1/demo/sites/${siteId}`));
    } catch (e) {
      setMessage((e as Error).message);
    }
  };
  useEffect(() => {
    setStatus(null);
    setMessage("");
    void load();
  }, [siteId]);
  useEffect(() => {
    if (!status?.rush_active) return;
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [status?.rush_active, siteId]);
  const run = async (name: string, action: () => Promise<DemoStatus>, done: (next: DemoStatus) => string) => {
    setBusy(name);
    setMessage("");
    try {
      const next = await action();
      setStatus(next);
      setMessage(done(next));
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  if (!siteId) return <Card><Label style={s.muted}>Choose a place first.</Label></Card>;
  const tz = (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return undefined;
    }
  })();
  return (
    <Card>
      <CardHeader title={`Demo mode · ${siteName ?? "this place"}`} />
      <Label style={s.muted}>
        Simulated customers fill the café for the video. They are labelled “Simulated” everywhere, never come from a camera, and
        Analytics can hide them with Live only. Only this account sees demo mode.
      </Label>
      <Label style={s.strong}>
        {status
          ? `${status.simulated_visits} simulated · ${status.live_visits} live Ring visits${status.rush_active ? " · rush running" : ""}`
          : "Loading…"}
      </Label>
      <Button icon="history" title={busy === "week" ? "Creating…" : "Create two simulated weeks"} disabled={!!busy}
        onPress={() => void run("week", () => request<DemoStatus>(`/v1/demo/sites/${siteId}/history`, "POST", { tz, seed: 1 }, 90000),
          (next) => `Created two weeks of simulated customers (${next.simulated_visits} visits).`)} />
      <Button variant="secondary" icon="users" title={status?.rush_active ? "Rush running…" : "Start a lunch rush"}
        disabled={!!busy || !!status?.rush_active}
        onPress={() => void run("rush", () => request<DemoStatus>(`/v1/demo/sites/${siteId}/rush`, "POST", { customers: 6, interval_seconds: 12 }),
          () => "Lunch rush started: 6 simulated customers join the counter queue over about a minute.")} />
      <Button variant="danger" icon="trash" title="Remove simulated data" disabled={!!busy || !status?.simulated_visits}
        onPress={() => Alert.alert("Remove simulated data?", "Every simulated customer, and the alerts and insight they produced, will be removed. Real Ring visits stay.", [
          { text: "Cancel", style: "cancel" },
          { text: "Remove", style: "destructive", onPress: () => void run("clear",
            () => request<DemoStatus>(`/v1/demo/sites/${siteId}/simulated`, "DELETE", undefined, 60000),
            () => "Removed the simulated customers. Real Ring visits are untouched.") },
        ])} />
      {!!message && <Label style={{ fontSize: 14 }}>{message}</Label>}
    </Card>
  );
}

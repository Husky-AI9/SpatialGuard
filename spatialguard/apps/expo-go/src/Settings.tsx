import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, View } from "react-native";
import { request, type Site, type Device } from "./api";
import { Button, Card, Label, styles as s, colors } from "./ui";
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
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      setMessage("Saved");
    } catch (e) {
      setMessage((e as Error).message);
    }
  };
  return (
    <>
      <Card>
        <Label style={s.heading}>Connect Ring</Label>
        {!consent ? (
          <Button title="Allow Ring data" onPress={() => void run(enable)} />
        ) : (
          <>
            <Label>
              Authorize SpatialGuard in your Ring app, then use this single-use
              code to link your account.
            </Label>
            <Button
              title="Get linking code"
              onPress={() =>
                void run(async () => {
                  const r = await request<{ code: string }>(
                    "/v1/ring/sign-in-code",
                    "POST",
                  );
                  Alert.alert("Ring linking code", r.code);
                })
              }
            />
            <Button title="Refresh cameras" onPress={() => void run(refresh)} />
          </>
        )}
        {!!message && <Label>{message}</Label>}
      </Card>
      {devices.map((d) => (
        <Card key={d.id}>
          <Label style={s.heading}>{d.name}</Label>
          <Label style={s.muted}>Pair with a camera on your floor plan</Label>
          {sites.flatMap((site) =>
            (site.layout.cameras ?? []).map((c) => (
              <Button
                key={site.id + c.id}
                title={`${site.name} · ${c.name}${d.site_id === site.id && d.camera_id === c.id ? " ✓" : ""}`}
                onPress={() =>
                  void run(async () => {
                    await request(
                      `/v1/ring/devices/${encodeURIComponent(d.id)}/mapping`,
                      "PUT",
                      { site_id: site.id, camera_id: c.id },
                    );
                    await refresh();
                  })
                }
              />
            )),
          )}
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
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  return error ? (
    <Card>
      <Label>{error}</Label>
    </Card>
  ) : !data ? (
    <ActivityIndicator color={colors.purple} />
  ) : (
    <>
      <Card>
        <Label style={s.heading}>Camera health</Label>
        {data.devices.map((d) => (
          <View key={d.id} style={{ gap: 4 }}>
            <Label>
              {d.name} · {d.online ? "Online" : "Offline"}
            </Label>
            <Label style={s.muted}>
              {d.uptime_percent === null
                ? "No history yet"
                : `${d.uptime_percent}% uptime`}{" "}
              · Checked {new Date(d.checked_at).toLocaleString()}
            </Label>
          </View>
        ))}
        {!data.devices.length && <Label>No connected cameras.</Label>}
      </Card>
      <Card>
        <Label style={s.heading}>Status alerts</Label>
        {data.alerts.map((a) => (
          <Label key={a.id}>
            {data.devices.find((d) => d.id === a.device)?.name || "Camera"} ·{" "}
            {a.kind} · {new Date(a.at * 1000).toLocaleString()}
          </Label>
        ))}
        {!data.alerts.length && <Label>No status changes recorded.</Label>}
      </Card>
      <Card>
        <Label style={s.heading}>Time-lapse</Label>
        {data.projects.map((p) => (
          <View key={p.id}>
            <Label>{p.name}</Label>
            <Label style={s.muted}>
              {p.frame_count} frames · Every {p.cadence_minutes} minutes
            </Label>
          </View>
        ))}
        {!data.projects.length && <Label>No time-lapse projects.</Label>}
      </Card>
    </>
  );
}

import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  Switch,
  TextInput,
  View,
} from "react-native";
import {
  ApiError,
  ORIGIN,
  forget,
  request,
  type Device,
  type Incident,
  type Session,
  type Site,
} from "./api";
import {
  Button,
  Card,
  CardHeader,
  Chip,
  Icon,
  IconButton,
  Label,
  Sheet,
  colors,
  styles as s,
  type IconName,
} from "./ui";
import FloorMap from "./Map";
import LivePlayer from "./LivePlayer";
import { Snapshot, Recording } from "./Media";
import { Operations, RingSettings } from "./Settings";
import type { components } from "../../web/src/generated";
type Preferences = components["schemas"]["AccountPreferences"];
type Tab = "Home" | "Incidents" | "Cameras" | "Operations" | "Settings";
type Section = "" | "Account" | "Places & floor plans" | "Privacy" | "Ring cameras" | "Delete account";
const tabs: { name: Tab; icon: IconName }[] = [
  { name: "Home", icon: "house" },
  { name: "Incidents", icon: "history" },
  { name: "Cameras", icon: "camera" },
  { name: "Operations", icon: "activity" },
  { name: "Settings", icon: "settings" },
];
const sections: Section[] = ["Account", "Places & floor plans", "Privacy", "Ring cameras", "Delete account"];
const uuid = () =>
  "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
const stamp = (value: string) =>
  new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const mode = (m: Incident["evidence_mode"]) => (m === "live" ? "Live" : m === "replay" ? "Replay" : "Simulator");

export default function Workspace({ onSignout }: { onSignout: () => void }) {
  const [tab, setTab] = useState<Tab>("Home"),
    [sites, setSites] = useState<Site[]>([]),
    [site, setSite] = useState<Site | null>(null),
    [incidents, setIncidents] = useState<Incident[]>([]),
    [cursor, setCursor] = useState<number | null>(null),
    [devices, setDevices] = useState<Device[]>([]),
    [selected, setSelected] = useState<Incident | null>(null),
    [device, setDevice] = useState<Device | null>(null),
    [section, setSection] = useState<Section>(""),
    [prefs, setPrefs] = useState<Preferences | null>(null),
    [me, setMe] = useState<Session | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [pairFor, setPairFor] = useState<{ id: string; name: string } | null>(null),
    [ringState, setRingState] = useState("");
  const activeId = useRef(""),
    alive = useRef(true),
    loading = useRef(false);
  const load = async (id?: string) => {
    if (loading.current) return;
    loading.current = true;
    setBusy(true);
    try {
      const [all, user, preferences] = await Promise.all([
        request<Site[]>("/v1/sites"),
        request<Session>("/v1/me"),
        request<Preferences>("/v1/account/preferences"),
      ]);
      if (!alive.current) return;
      setSites(all);
      setMe(user);
      setPrefs(preferences);
      const active =
        all.find((s) => s.id === (id || activeId.current)) || all[0];
      activeId.current = active?.id || "";
      setSite(active || null);
      if (active) {
        const page = await request<components["schemas"]["IncidentPage"]>(
          `/v1/sites/${active.id}/incidents`,
        );
        if (!alive.current) return;
        setIncidents(page.incidents);
        setCursor(page.next_cursor ?? null);
      }
      if (preferences.ring_data_consent) {
        const status = await request<{ state: string }>("/v1/ring").catch(() => ({ state: "unavailable" }));
        const d = status.state === "connected" ? await request<Device[]>("/v1/ring/devices") : [];
        if (!alive.current) return;
        setRingState(status.state);
        setDevices(d);
      } else {
        setRingState("");
        setDevices([]);
      }
      setError("");
    } catch (e) {
      if (!alive.current) return;
      if (e instanceof ApiError && e.status === 401) {
        await forget();
        onSignout();
      } else setError((e as Error).message);
    } finally {
      loading.current = false;
      if (alive.current) setBusy(false);
    }
  };
  useEffect(() => {
    alive.current = true;
    void load();
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") void load();
    });
    return () => {
      alive.current = false;
      listener.remove();
    };
  }, []);
  const action = async (fn: () => Promise<unknown>, refresh = true) => {
    setBusy(true);
    try {
      await fn();
      if (refresh && alive.current) await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const patch = async (values: Partial<Preferences>) =>
    setPrefs(await request<Preferences>("/v1/account/preferences", "PATCH", values));
  const mapped = (cameraId: string) =>
    devices.find((d) => d.site_id === site?.id && d.camera_id === cameraId);
  const pick = (id: string) => {
    const d = mapped(id);
    if (d) {
      setDevice(d);
      setTab("Cameras");
    } else {
      const camera = site?.layout.cameras?.find((c) => c.id === id);
      if (camera) setPairFor({ id: camera.id, name: camera.name });
    }
  };
  const setMonitoring = (enabled: boolean, cameraIds = site?.monitoring.camera_ids ?? []) => {
    if (!site) return;
    void action(() =>
      request(`/v1/sites/${site.id}/monitoring`, "PATCH", {
        enabled,
        camera_ids: cameraIds,
        classification_enabled: site.monitoring.classification_enabled,
      }),
    );
  };
  const deleteIncident = (incident: Incident) =>
    Alert.alert("Delete incident?", "This removes the incident and its evidence.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () =>
          void action(async () => {
            await request(`/v1/incidents/${encodeURIComponent(incident.id)}`, "DELETE");
            if (selected?.id === incident.id) setSelected(null);
          }),
      },
    ]);
  const cameras = site?.layout.cameras ?? [];
  const title = selected ? "Incident" : section || tab;

  const monitorCard = site && (
    <Card>
      <View style={s.row}>
        <View style={{ flex: 1 }}>
          <Label style={s.strong}>
            {site.monitoring.enabled ? "Monitoring enabled" : "Monitoring paused"}
          </Label>
          <Label style={[s.muted, { fontSize: 13 }]}>
            {site.monitoring.camera_ids.length} selected cameras
          </Label>
        </View>
        <Button
          small
          variant="secondary"
          icon={site.monitoring.enabled ? "pause" : "play"}
          title={site.monitoring.enabled ? "Pause" : "Enable"}
          disabled={busy}
          onPress={() => setMonitoring(!site.monitoring.enabled)}
        />
        <Button
          small
          icon="play"
          title="Run replay"
          disabled={busy || !site.monitoring.enabled || !site.monitoring.camera_ids.length}
          onPress={() =>
            void action(() => request(`/v1/sites/${site.id}/replay`, "POST", { request_id: uuid() }))
          }
        />
      </View>
    </Card>
  );

  const ringBanner = ringState !== "connected" && (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        setTab("Settings");
        setSection("Ring cameras");
      }}
      style={({ pressed }) => [
        s.row,
        {
          padding: 14,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: "#c9c3f7",
          backgroundColor: pressed ? "#e3e0fc" : colors.purpleSoft,
        },
      ]}
    >
      <Icon name="link" size={19} color={colors.purple} />
      <View style={{ flex: 1 }}>
        <Label style={[s.strong, { color: "#3f35c9" }]}>Connect Ring cameras</Label>
        <Label style={[s.muted, { fontSize: 13 }]}>Link your Ring account</Label>
      </View>
      <Icon name="external" size={17} color={colors.purple} />
    </Pressable>
  );

  const cameraList = (withSwitches: boolean) => (
    <Card>
      <CardHeader
        title="CCTVs"
        detail={`${cameras.length} devices`}
        action={
          withSwitches ? (
            <Chip text={ringState === "connected" ? "Ring connected" : "Ring not linked"} tone={ringState === "connected" ? "success" : "muted"} />
          ) : (
            <Button small title="View all" onPress={() => setTab("Cameras")} />
          )
        }
      />
      {cameras.map((camera) => {
        const ring = mapped(camera.id);
        const included = !!site?.monitoring.camera_ids.includes(camera.id);
        return (
          <View key={camera.id} style={{ borderRadius: 14, backgroundColor: "#f6f5fc", borderWidth: 1, borderColor: device?.id && ring?.id === device.id ? "#bdb8f1" : "transparent" }}>
            <View style={[s.row, { padding: 10 }]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open ${camera.name}`}
                style={[s.row, { flex: 1 }]}
                onPress={() => (ring ? (setDevice(ring), setTab("Cameras")) : setPairFor({ id: camera.id, name: camera.name }))}
              >
                {ring ? (
                  <Snapshot device={ring} />
                ) : (
                  <View style={{ width: 56, height: 56, borderRadius: 12, backgroundColor: "#e6e6f3", alignItems: "center", justifyContent: "center" }}>
                    <Icon name="camera" size={20} color="#39406b" />
                  </View>
                )}
                <View style={{ flex: 1, gap: 1 }}>
                  <Label style={s.strong} numberOfLines={1}>{camera.name}</Label>
                  <Label style={[s.muted, { fontSize: 13 }]}>{ring ? "Ring camera" : "Floor-plan camera"}</Label>
                  <Label style={{ fontSize: 12, fontFamily: "SourceSansBold", color: ring ? "#1f7a45" : colors.purple }}>
                    {ring ? "● Live available" : "Not paired"}
                  </Label>
                </View>
              </Pressable>
              {!ring && <Button small title="Pair" onPress={() => setPairFor({ id: camera.id, name: camera.name })} />}
            </View>
            {withSwitches && site && (
              <View style={[s.row, { justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 6, borderTopWidth: 1, borderColor: "#e4e2f6" }]}>
                <Label style={{ fontSize: 13, fontFamily: "SourceSansBold", color: colors.muted }}>Monitor</Label>
                <Switch
                  accessibilityLabel={`Monitor ${camera.name}`}
                  value={included}
                  disabled={busy}
                  trackColor={{ true: colors.purple, false: "#bfc2d1" }}
                  thumbColor="#ffffff"
                  onValueChange={(checked) =>
                    setMonitoring(
                      site.monitoring.enabled,
                      checked
                        ? [...site.monitoring.camera_ids, camera.id]
                        : site.monitoring.camera_ids.filter((id) => id !== camera.id),
                    )
                  }
                />
              </View>
            )}
          </View>
        );
      })}
      {!cameras.length && (
        <View style={{ alignItems: "center", paddingVertical: 18, gap: 6 }}>
          <Icon name="camera" size={22} color={colors.muted} />
          <Label style={s.muted}>No cameras placed yet.</Label>
        </View>
      )}
    </Card>
  );

  const incidentList = (heading: string) => (
    <Card style={{ paddingHorizontal: 0, paddingBottom: 4, gap: 0 }}>
      <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
        <CardHeader title={heading} detail={`${incidents.length} shown`} />
      </View>
      {incidents.map((i) => (
        <View key={i.id} style={[s.row, { paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderColor: colors.line }]}>
          <Pressable accessibilityRole="button" onPress={() => { setSelected(i); setDevice(null); }} style={[s.row, { flex: 1 }]}>
            <Icon name="pin" size={20} color="#e59a9a" />
            <View style={{ flex: 1, gap: 2 }}>
              <Label style={s.strong} numberOfLines={1}>{i.classification?.display_label || i.title}</Label>
              <Label style={[s.muted, { fontSize: 13 }]}>{stamp(i.started_at)} · {mode(i.evidence_mode)}</Label>
              <Chip text={i.status === "reviewed" ? "Reviewed" : "Needs review"} tone={i.status === "reviewed" ? "muted" : "accent"} />
            </View>
          </Pressable>
          <IconButton icon="trash" label={`Delete ${i.title}`} color={colors.muted} tint="transparent" onPress={() => deleteIncident(i)} />
        </View>
      ))}
      {!incidents.length && (
        <View style={{ alignItems: "center", padding: 24, gap: 6 }}>
          <Icon name="history" size={24} color="#e59a9a" />
          <Label style={s.strong}>No incidents yet</Label>
          <Label style={s.muted}>Activity your cameras record shows up here.</Label>
        </View>
      )}
      {cursor !== null && site && (
        <View style={{ padding: 12 }}>
          <Button
            variant="secondary"
            title="Load older incidents"
            disabled={busy}
            onPress={() =>
              void action(async () => {
                const p = await request<components["schemas"]["IncidentPage"]>(
                  `/v1/sites/${site.id}/incidents?before=${cursor}`,
                );
                setIncidents((v) => [...v, ...p.incidents]);
                setCursor(p.next_cursor ?? null);
              }, false)
            }
          />
        </View>
      )}
    </Card>
  );

  const incidentDetail = selected && (
    <>
      <Pressable accessibilityRole="button" onPress={() => setSelected(null)} style={[s.row, { gap: 6, paddingVertical: 4 }]}>
        <Icon name="back" size={18} color={colors.ink} />
        <Label style={s.strong}>All incidents</Label>
      </Pressable>
      <Card>
        <Label style={s.title}>{selected.classification?.display_label || selected.title}</Label>
        <Label style={s.muted}>{stamp(selected.started_at)} · {mode(selected.evidence_mode)}</Label>
        <View style={s.row}>
          <Button
            style={{ flex: 1 }}
            icon="check"
            title={selected.status === "reviewed" ? "Reviewed" : "Mark reviewed"}
            disabled={busy || selected.status === "reviewed"}
            onPress={() =>
              void action(async () =>
                setSelected(await request<Incident>(`/v1/incidents/${selected.id}/review`, "POST", { status: "reviewed" })),
              )
            }
          />
          <IconButton icon="trash" label="Delete incident" color={colors.danger} onPress={() => deleteIncident(selected)} />
        </View>
      </Card>
      {site && selected.revision_id === site.revision_id && (
        <Card>
          <FloorMap site={site} incident={selected} onCamera={pick} />
        </Card>
      )}
      {selected.classification && (
        <Card>
          <Label style={s.heading}>{selected.classification.display_label}</Label>
          <Label>{selected.classification.summary}</Label>
          <Chip text="AI label · please review" tone="muted" />
        </Card>
      )}
      {selected.observations.map((o) => (
        <Card key={o.observation_id}>
          <CardHeader
            title={site?.layout.cameras?.find((c) => c.id === o.source_id)?.name || "Camera event"}
            detail={`${new Date(o.observed_at).toLocaleTimeString()} · ${o.category}`}
          />
          <Label style={[s.muted, { fontSize: 13 }]}>
            {o.location.kind === "unknown" ? "Location unknown" : o.location.kind === "room" ? "Seen in a room" : "Estimated position"}
          </Label>
          {selected.evidence_mode === "live" && <Recording incident={selected.id} observation={o.observation_id} />}
        </Card>
      ))}
    </>
  );

  const settingsSection = () => {
    if (section === "Ring cameras")
      return (
        <RingSettings
          sites={sites}
          devices={devices}
          consent={!!prefs?.ring_data_consent}
          enable={() => action(() => patch({ ring_data_consent: true }))}
          refresh={() => action(() => request("/v1/ring/devices/refresh", "POST"))}
        />
      );
    if (section === "Places & floor plans")
      return (
        <Card>
          <CardHeader title="Places" detail={sites.length ? undefined : "No places yet."} />
          {sites.map((item) => (
            <View key={item.id} style={[s.row, { paddingVertical: 8, borderTopWidth: 1, borderColor: colors.line }]}>
              <View style={{ flex: 1 }}>
                <Label style={s.strong}>{item.name}</Label>
                <Label style={[s.muted, { fontSize: 13 }]}>
                  {(item.layout.rooms ?? []).length} spaces · {(item.layout.cameras ?? []).length} cameras
                </Label>
              </View>
              <Button
                small
                variant={site?.id === item.id ? "secondary" : "primary"}
                title={site?.id === item.id ? "Current" : "Open"}
                disabled={site?.id === item.id}
                onPress={() => {
                  setSelected(null);
                  setDevice(null);
                  void load(item.id);
                }}
              />
            </View>
          ))}
          <Button variant="secondary" icon="play" title="Load demo home" disabled={busy} onPress={() => void action(() => request("/v1/sample-site", "POST"))} />
          <Label style={[s.muted, { fontSize: 13 }]}>Upload floor plans on spatialguard.app.</Label>
        </Card>
      );
    if (section === "Privacy")
      return (
        <Card>
          <Label style={s.heading}>Privacy</Label>
          {([
            ["ring_data_consent", "Ring cameras", "Live view, events and camera status."],
            ["classification_consent", "Activity labels", "Event snapshots are sent to OpenAI to label activity."],
          ] as const).map(([key, name, detail]) => (
            <View key={key} style={[s.row, { paddingVertical: 6, borderTopWidth: 1, borderColor: colors.line }]}>
              <View style={{ flex: 1 }}>
                <Label style={s.strong}>{name}</Label>
                <Label style={[s.muted, { fontSize: 13 }]}>{detail}</Label>
              </View>
              <Switch
                accessibilityLabel={name}
                value={!!prefs?.[key]}
                disabled={busy || (key === "classification_consent" && !prefs?.ring_data_consent)}
                onValueChange={(v) => void action(() => patch({ [key]: v }))}
                trackColor={{ true: colors.purple, false: "#bfc2d1" }}
                thumbColor="#ffffff"
              />
            </View>
          ))}
          <View style={[s.row, { gap: 18 }]}>
            {[["Privacy", "/privacy"], ["Terms", "/terms"], ["Data deletion", "/data-deletion"]].map(([name, path]) => (
              <Pressable key={path} accessibilityRole="link" onPress={() => void Linking.openURL(ORIGIN + path)}>
                <Label style={{ color: colors.purple, fontFamily: "SourceSansBold", fontSize: 14 }}>{name}</Label>
              </Pressable>
            ))}
          </View>
        </Card>
      );
    if (section === "Delete account") return <DeleteAccount onDeleted={onSignout} />;
    return (
      <Card>
        <Label style={s.heading}>Account</Label>
        <Label style={s.muted}>{me?.email || "Signed in"}</Label>
        <Button
          variant="secondary"
          title="Reset password"
          onPress={() =>
            void action(async () => {
              const r = await request<{ message: string }>("/v1/auth/password/request", "POST", { email: me?.email });
              Alert.alert("Check your email", r.message);
            }, false)
          }
        />
        <Button
          variant="secondary"
          icon="logout"
          title="Sign out"
          onPress={() =>
            void action(async () => {
              await request("/v1/auth/signout", "POST");
              await forget();
              onSignout();
            }, false)
          }
        />
      </Card>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <View style={[s.row, { paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.card, borderBottomWidth: 1, borderColor: colors.line }]}>
        {section && !selected ? (
          <IconButton icon="back" label="Back to Settings" onPress={() => setSection("")} />
        ) : null}
        <View style={{ flex: 1 }}>
          {!!site && tab !== "Settings" && !selected && (
            <Label style={[s.muted, { fontSize: 12, fontFamily: "SourceSansBold" }]} numberOfLines={1}>{site.name}</Label>
          )}
          <Label style={s.title} numberOfLines={1}>{title}</Label>
        </View>
        <IconButton icon="refresh" label="Refresh" onPress={() => void load()} />
      </View>
      {!!error && (
        <View style={[s.row, { margin: 12, marginBottom: 0, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: "#f3c4c9", backgroundColor: "#fff4f5" }]} accessibilityRole="alert">
          <Label style={{ flex: 1, color: "#7c1d26", fontSize: 14 }}>{error}</Label>
          <Button small variant="secondary" title="Retry" onPress={() => void load()} />
        </View>
      )}
      <ScrollView
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={busy} onRefresh={() => void load()} tintColor={colors.purple} />}
        contentContainerStyle={s.content}
      >
        {selected ? (
          incidentDetail
        ) : tab === "Home" ? (
          site ? (
            <>
              {monitorCard}
              {ringBanner}
              <Card>
                <FloorMap site={site} selected={device?.camera_id || undefined} onCamera={pick} />
              </Card>
              {cameraList(false)}
              {incidentList("Recent incidents")}
            </>
          ) : (
            <Card style={{ alignItems: "center", paddingVertical: 28 }}>
              <Icon name="map" size={28} color={colors.muted} />
              <Label style={s.heading}>No floor plan yet</Label>
              <Label style={[s.muted, { textAlign: "center" }]}>Upload a drawing of your home on spatialguard.app, or try the demo home.</Label>
              <Button icon="play" title="Load demo home" disabled={busy} onPress={() => void action(() => request("/v1/sample-site", "POST"))} />
            </Card>
          )
        ) : tab === "Cameras" ? (
          <>
            {device ? (
              <Card style={{ padding: 0, overflow: "hidden", gap: 0 }}>
                <View style={[s.row, { padding: 14 }]}>
                  <View style={{ flex: 1 }}>
                    <Label style={s.strong}>{device.name}</Label>
                    <Label style={[s.muted, { fontSize: 13 }]}>Ring live view</Label>
                  </View>
                  <Button small variant="secondary" title="Close" onPress={() => setDevice(null)} />
                </View>
                <LivePlayer key={device.id} device={device} />
              </Card>
            ) : (
              <Card style={{ alignItems: "center", backgroundColor: "#1d1f2e", borderColor: "#1d1f2e", paddingVertical: 36 }}>
                <Icon name="camera" size={30} color="#b9bdd6" />
                <Label style={[s.strong, { color: "#ffffff" }]}>Choose a camera</Label>
                <Label style={{ color: "#c9cce0", fontSize: 13 }}>Paired cameras play live here.</Label>
              </Card>
            )}
            {cameraList(true)}
          </>
        ) : tab === "Incidents" ? (
          incidentList("Incident history")
        ) : tab === "Operations" ? (
          <Operations />
        ) : section ? (
          settingsSection()
        ) : (
          <Card style={{ padding: 0, gap: 0, overflow: "hidden" }}>
            {sections.map((name, i) => (
              <Pressable
                key={name}
                accessibilityRole="button"
                onPress={() => setSection(name)}
                style={({ pressed }) => [
                  s.row,
                  { paddingHorizontal: 16, paddingVertical: 15, borderTopWidth: i ? 1 : 0, borderColor: colors.line, backgroundColor: pressed ? "#f6f6fd" : colors.card },
                ]}
              >
                <Label style={[s.strong, { flex: 1, fontSize: 16 }, name === "Delete account" && { color: colors.danger }]}>{name}</Label>
                <Icon name="chevron" size={17} color={name === "Delete account" ? colors.danger : colors.ink} />
              </Pressable>
            ))}
          </Card>
        )}
      </ScrollView>
      <View style={{ flexDirection: "row", backgroundColor: colors.card, borderTopWidth: 1, borderColor: colors.line }}>
        {tabs.map((t) => {
          const active = tab === t.name;
          return (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={t.name}
              key={t.name}
              onPress={() => {
                setTab(t.name);
                setSelected(null);
                setSection("");
                if (t.name !== "Cameras") setDevice(null);
              }}
              style={{ flex: 1, alignItems: "center", paddingTop: 10, paddingBottom: 8, gap: 4, borderTopWidth: 3, borderColor: active ? colors.purple : "transparent" }}
            >
              <Icon name={t.icon} size={21} color={active ? colors.purple : "#4b5068"} />
              <Label style={{ fontSize: 11, color: active ? colors.purple : "#4b5068", fontFamily: "SourceSansBold" }}>{t.name}</Label>
            </Pressable>
          );
        })}
      </View>
      <PairSheet
        target={pairFor}
        site={site}
        devices={devices}
        consent={!!prefs?.ring_data_consent}
        ringState={ringState}
        onAllow={() => action(() => patch({ ring_data_consent: true }))}
        onLink={() => {
          setPairFor(null);
          setTab("Settings");
          setSection("Ring cameras");
        }}
        onPaired={() => void load()}
        onClose={() => setPairFor(null)}
      />
    </View>
  );
}

/** Pair a floor-plan camera with a Ring camera without leaving the screen. */
function PairSheet({
  target,
  site,
  devices,
  consent,
  ringState,
  onAllow,
  onLink,
  onPaired,
  onClose,
}: {
  target: { id: string; name: string } | null;
  site: Site | null;
  devices: Device[];
  consent: boolean;
  ringState: string;
  onAllow: () => Promise<unknown>;
  onLink: () => void;
  onPaired: () => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => setError(""), [target?.id]);
  const pair = async (device: Device) => {
    if (!site || !target) return;
    setBusy(true);
    setError("");
    try {
      await request(`/v1/ring/devices/${encodeURIComponent(device.id)}/mapping`, "PUT", { site_id: site.id, camera_id: target.id });
      onPaired();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const state = (icon: IconName, heading: string, detail: string, button: React.ReactNode) => (
    <View style={{ alignItems: "center", gap: 8, paddingVertical: 12 }}>
      <Icon name={icon} size={24} color={colors.purple} />
      <Label style={s.heading}>{heading}</Label>
      <Label style={[s.muted, { textAlign: "center" }]}>{detail}</Label>
      <View style={{ alignSelf: "stretch", marginTop: 6 }}>{button}</View>
    </View>
  );
  return (
    <Sheet visible={!!target} title={`Pair ${target?.name ?? ""}`} subtitle="Choose the Ring camera at this spot" onClose={onClose}>
      {!consent
        ? state("link", "Allow Ring camera access", "SpatialGuard needs your permission to use your Ring cameras.",
            <Button title="Allow and continue" disabled={busy} onPress={() => void onAllow()} />)
        : ringState !== "connected"
          ? state("link", "Link your Ring account", "Authorize SpatialGuard in Ring once, then pair cameras here.",
              <Button title="Link Ring account" onPress={onLink} />)
          : !devices.length
            ? state("camera", "No Ring cameras found", "Share cameras with SpatialGuard in the Ring app, then refresh.",
                <Button variant="secondary" title="Close" onPress={onClose} />)
            : (
              <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={{ gap: 8 }}>
                {devices.map((d) => {
                  const here = d.site_id === site?.id && d.camera_id === target?.id;
                  const usable = d.support?.motion_events !== false;
                  return (
                    <Pressable
                      key={d.id}
                      accessibilityRole="button"
                      disabled={busy || here || !usable}
                      onPress={() => void pair(d)}
                      style={({ pressed }) => [
                        s.row,
                        { padding: 12, borderRadius: 14, borderWidth: 1, borderColor: here ? colors.purple : colors.line, backgroundColor: here || pressed ? colors.purpleSoft : colors.card, opacity: usable ? 1 : 0.55 },
                      ]}
                    >
                      <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: colors.purpleSoft, alignItems: "center", justifyContent: "center" }}>
                        <Icon name="camera" size={20} color={colors.purple} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Label style={s.strong}>{d.name}</Label>
                        <Label style={[s.muted, { fontSize: 13 }]}>
                          {here ? "Paired with this camera" : !usable ? "Not compatible" : d.camera_id ? "Paired elsewhere · tap to move here" : "Available"}
                        </Label>
                      </View>
                      {here && <Icon name="check" size={18} color={colors.purple} />}
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}
      {busy && <ActivityIndicator color={colors.purple} />}
      {!!error && <Label style={{ color: colors.danger, fontSize: 13 }}>{error}</Label>}
    </Sheet>
  );
}

/** In-app account deletion (required by the App Store and Play policies). */
function DeleteAccount({ onDeleted }: { onDeleted: () => void }) {
  const [password, setPassword] = useState(""),
    [confirm, setConfirm] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const remove = async () => {
    setBusy(true);
    setError("");
    try {
      await request("/v1/account", "DELETE", { password, confirmation: confirm });
      await forget();
      Alert.alert("Account deleted", "Your account and its data have been removed.");
      onDeleted();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Card>
      <Label style={[s.heading, { color: colors.danger }]}>Delete account</Label>
      <Label style={s.muted}>Deletes your account and all its data. This can’t be undone.</Label>
      <Label style={s.strong}>Password</Label>
      <TextInput style={s.input} secureTextEntry value={password} onChangeText={setPassword} autoComplete="current-password" accessibilityLabel="Password" />
      <Label style={s.strong}>Type DELETE to confirm</Label>
      <TextInput style={s.input} autoCapitalize="characters" value={confirm} onChangeText={setConfirm} accessibilityLabel="Type DELETE to confirm" />
      {!!error && <Label style={{ color: colors.danger, fontSize: 13 }}>{error}</Label>}
      <Button variant="danger" icon="trash" title={busy ? "Deleting…" : "Delete my account"} disabled={busy || password.length < 8 || confirm !== "DELETE"} onPress={() => void remove()} />
    </Card>
  );
}

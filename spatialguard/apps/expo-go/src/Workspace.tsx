import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  AppState,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  Switch,
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
import { Button, Card, Label, Mark, colors, styles as s } from "./ui";
import FloorMap from "./Map";
import LivePlayer from "./LivePlayer";
import { Snapshot, Recording } from "./Media";
import { Operations, RingSettings } from "./Settings";
import type { components } from "../../web/src/generated";
type Preferences = components["schemas"]["AccountPreferences"];
type Tab = "Home" | "Incidents" | "Cameras" | "Operations" | "Settings";
const tabs: Tab[] = ["Home", "Incidents", "Cameras", "Operations", "Settings"];
export default function Workspace({ onSignout }: { onSignout: () => void }) {
  const [tab, setTab] = useState<Tab>("Home"),
    [sites, setSites] = useState<Site[]>([]),
    [site, setSite] = useState<Site | null>(null),
    [incidents, setIncidents] = useState<Incident[]>([]),
    [cursor, setCursor] = useState<number | null>(null),
    [devices, setDevices] = useState<Device[]>([]),
    [selected, setSelected] = useState<Incident | null>(null),
    [device, setDevice] = useState<Device | null>(null),
    [section, setSection] = useState(""),
    [prefs, setPrefs] = useState<Preferences | null>(null),
    [me, setMe] = useState<Session | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [last, setLast] = useState("");
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
        const d = await request<Device[]>("/v1/ring/devices");
        if (!alive.current) return;
        setDevices(d);
      } else setDevices([]);
      setLast(new Date().toLocaleTimeString());
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
  const open = (item: Incident) => {
    setSelected(item);
    setDevice(null);
  };
  const pick = (id: string) => {
    const d = devices.find((d) => d.site_id === site?.id && d.camera_id === id);
    if (d) setDevice(d);
    else {
      setTab("Settings");
      setSection("Ring cameras");
    }
  };
  const patch = async (values: Partial<Preferences>) =>
    setPrefs(
      await request<Preferences>("/v1/account/preferences", "PATCH", values),
    );
  const cameras = (
    <Card>
      <View style={s.row}>
        <Label style={[s.heading, { flex: 1 }]}>
          {device?.name || "CCTVs"}
        </Label>
        <Button
          title={device ? "All cameras" : "Pair camera"}
          onPress={() =>
            device
              ? setDevice(null)
              : (setTab("Settings"), setSection("Ring cameras"))
          }
        />
      </View>
      {device ? (
        <LivePlayer key={device.id} device={device} />
      ) : (
        <ScrollView nestedScrollEnabled style={{ maxHeight: 290 }}>
          {devices
            .filter((d) => !d.site_id || d.site_id === site?.id)
            .map((d) => (
              <Pressable
                accessibilityRole="button"
                key={d.id}
                style={[s.row, { paddingVertical: 12, minHeight: 88 }]}
                onPress={() => setDevice(d)}
              >
                <Snapshot device={d} />
                <View style={{ flex: 1 }}>
                  <Label style={{ fontFamily: "SourceSansBold" }}>
                    {d.name}
                  </Label>
                  <Label style={s.muted}>
                    {d.camera_id
                      ? "Open live view"
                      : "Not paired to floor plan"}
                  </Label>
                </View>
                <Label>›</Label>
              </Pressable>
            ))}
          {!devices.length && (
            <Label>
              No cameras connected. Pair your Ring cameras to get started.
            </Label>
          )}
        </ScrollView>
      )}
    </Card>
  );
  const list = (
    <Card>
      <Label style={s.heading}>Recent incidents</Label>
      {incidents.map((i) => (
        <Pressable
          key={i.id}
          accessibilityRole="button"
          onPress={() => open(i)}
          style={{
            paddingVertical: 12,
            borderBottomWidth: 1,
            borderColor: colors.border,
          }}
        >
          <Label style={{ fontFamily: "SourceSansBold" }}>
            {i.classification?.display_label || i.title}
          </Label>
          <Label style={s.muted}>
            {new Date(i.started_at).toLocaleString()} ·{" "}
            {i.evidence_mode === "live"
              ? "Live integration"
              : i.evidence_mode === "replay"
                ? "Replay"
                : "Official simulator"}
          </Label>
          <Label
            style={{
              color: i.status === "reviewed" ? colors.muted : colors.purple,
            }}
          >
            {i.status === "reviewed" ? "Reviewed" : "Needs review"}
          </Label>
        </Pressable>
      ))}
      {!incidents.length && <Label>No incidents yet.</Label>}
      {cursor !== null && site && (
        <Button
          title="Load more"
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
      )}
    </Card>
  );
  return (
    <View style={{ flex: 1 }}>
      <View
        style={[
          s.row,
          { padding: 16, borderBottomWidth: 1, borderColor: colors.border },
        ]}
      >
        <Mark />
        <Label style={[s.title, { flex: 1 }]}>
          {selected ? "Incident" : section || tab}
        </Label>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh"
          onPress={() => void load()}
        >
          <Label style={{ color: colors.purple }}>Refresh</Label>
        </Pressable>
      </View>
      {!!error && (
        <Label style={s.error} accessibilityRole="alert">
          {error}
        </Label>
      )}
      <ScrollView
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={busy} onRefresh={() => void load()} />
        }
        contentContainerStyle={s.content}
      >
        {selected ? (
          <>
            <Button title="All incidents" onPress={() => setSelected(null)} />
            <Card>
              <Label style={s.title}>
                {selected.classification?.display_label || selected.title}
              </Label>
              <Label style={s.muted}>
                {new Date(selected.started_at).toLocaleString()} ·{" "}
                {selected.evidence_mode}
              </Label>
              <View style={s.row}>
                <Button
                  title={
                    selected.status === "reviewed"
                      ? "Reviewed"
                      : "Mark reviewed"
                  }
                  disabled={busy || selected.status === "reviewed"}
                  onPress={() =>
                    void action(async () =>
                      setSelected(
                        await request<Incident>(
                          `/v1/incidents/${selected.id}/review`,
                          "POST",
                          { status: "reviewed" },
                        ),
                      ),
                    )
                  }
                />
                <Button
                  title="Delete"
                  disabled={busy}
                  onPress={() =>
                    Alert.alert(
                      "Delete incident?",
                      "This removes the incident from your account.",
                      [
                        { text: "Cancel", style: "cancel" },
                        {
                          text: "Delete",
                          style: "destructive",
                          onPress: () =>
                            void action(async () => {
                              await request(
                                `/v1/incidents/${selected.id}`,
                                "DELETE",
                              );
                              setSelected(null);
                            }),
                        },
                      ],
                    )
                  }
                />
              </View>
            </Card>
            {site && selected.revision_id === site.revision_id && (
              <Card>
                <FloorMap site={site} incident={selected} onCamera={pick} />
              </Card>
            )}
            {selected.classification && (
              <Card>
                <Label style={s.heading}>
                  {selected.classification.display_label}
                </Label>
                <Label>{selected.classification.summary}</Label>
                <Label style={s.muted}>
                  {selected.classification.uncertainty}
                </Label>
              </Card>
            )}
            {selected.observations.map((o) => (
              <Card key={o.observation_id}>
                <Label style={s.heading}>
                  {site?.layout.cameras?.find((c) => c.id === o.source_id)
                    ?.name || "Camera observation"}
                </Label>
                <Label>
                  {new Date(o.observed_at).toLocaleTimeString()} · {o.category}
                </Label>
                <Label style={s.muted}>
                  {o.location.kind === "unknown"
                    ? "Position unknown"
                    : o.location.kind === "room"
                      ? "Room observation"
                      : "Observed position"}
                </Label>
                {selected.evidence_mode === "live" && (
                  <Recording
                    incident={selected.id}
                    observation={o.observation_id}
                  />
                )}
              </Card>
            ))}
          </>
        ) : tab === "Home" ? (
          <>
            {site ? (
              <>
                <Card>
                  <Label style={s.heading}>{site.name}</Label>
                  <View style={s.row}>
                    <Label style={{ flex: 1 }}>
                      {site.monitoring.enabled
                        ? "Monitoring enabled"
                        : "Monitoring paused"}
                    </Label>
                    <Switch
                      value={site.monitoring.enabled}
                      trackColor={{ true: colors.purple }}
                      onValueChange={(enabled) =>
                        void action(() =>
                          request(`/v1/sites/${site.id}/monitoring`, "PATCH", {
                            enabled,
                            camera_ids: site.monitoring.camera_ids,
                            classification_enabled:
                              site.monitoring.classification_enabled,
                          }),
                        )
                      }
                    />
                  </View>
                  <Label style={s.muted}>Updated {last || "…"}</Label>
                </Card>
                <Card>
                  <FloorMap
                    site={site}
                    selected={device?.camera_id || undefined}
                    onCamera={pick}
                  />
                </Card>
              </>
            ) : (
              <Card>
                <Label>No floor plan yet.</Label>
                <Button
                  title="Create sample home"
                  onPress={() =>
                    void action(() => request("/v1/sample-site", "POST"))
                  }
                />
              </Card>
            )}
            {cameras}
            {list}
          </>
        ) : tab === "Cameras" ? (
          cameras
        ) : tab === "Incidents" ? (
          list
        ) : tab === "Operations" ? (
          <Operations />
        ) : section ? (
          <>
            <Button title="Back to Settings" onPress={() => setSection("")} />
            {section === "Ring cameras" ? (
              <RingSettings
                sites={sites}
                devices={devices}
                consent={!!prefs?.ring_data_consent}
                enable={() => action(() => patch({ ring_data_consent: true }))}
                refresh={() =>
                  action(() => request("/v1/ring/devices/refresh", "POST"))
                }
              />
            ) : section === "Homes" ? (
              sites.map((item) => (
                <Card key={item.id}>
                  <Label>{item.name}</Label>
                  <Button
                    title={site?.id === item.id ? "Selected" : "Use this home"}
                    disabled={site?.id === item.id}
                    onPress={() => {
                      setSelected(null);
                      setDevice(null);
                      void load(item.id);
                    }}
                  />
                </Card>
              ))
            ) : section === "Privacy" ? (
              <Card>
                <Label style={s.heading}>Data permissions</Label>
                {(["ring_data_consent", "classification_consent"] as const).map(
                  (key) => (
                    <View key={key} style={s.row}>
                      <Label style={{ flex: 1 }}>
                        {key === "ring_data_consent"
                          ? "Process Ring events"
                          : "Analyze snapshots with AI"}
                      </Label>
                      <Switch
                        value={!!prefs?.[key]}
                        onValueChange={(v) =>
                          void action(() => patch({ [key]: v }))
                        }
                        trackColor={{ true: colors.purple }}
                      />
                    </View>
                  ),
                )}
                <Label style={s.muted}>
                  Snapshot analysis sends authorized images to the configured AI
                  provider.
                </Label>
                <Button
                  title="Privacy policy"
                  onPress={() => void Linking.openURL(ORIGIN + "/privacy")}
                />
              </Card>
            ) : (
              <Card>
                <Label>{me?.email}</Label>
                <Button
                  title="Send password reset email"
                  onPress={() =>
                    void action(async () => {
                      const r = await request<{ message: string }>(
                        "/v1/auth/password/request",
                        "POST",
                        { email: me?.email },
                      );
                      Alert.alert("Password reset", r.message);
                    })
                  }
                />
                <Button
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
            )}
          </>
        ) : (
          <Card>
            {["Ring cameras", "Homes", "Privacy", "Account"].map((name) => (
              <Pressable
                key={name}
                accessibilityRole="button"
                onPress={() => setSection(name)}
                style={[
                  s.row,
                  {
                    paddingVertical: 16,
                    borderBottomWidth: 1,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Label style={{ flex: 1 }}>{name}</Label>
                <Label>›</Label>
              </Pressable>
            ))}
            <Label style={s.muted}>{me?.email}</Label>
          </Card>
        )}
      </ScrollView>
      <View
        style={{
          flexDirection: "row",
          backgroundColor: "white",
          borderTopWidth: 1,
          borderColor: colors.border,
        }}
      >
        {tabs.map((t, i) => (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === t }}
            key={t}
            onPress={() => {
              setTab(t);
              setSelected(null);
              setSection("");
              setDevice(null);
            }}
            style={{
              flex: 1,
              alignItems: "center",
              paddingVertical: 12,
              gap: 3,
            }}
          >
            <Label
              style={{
                fontSize: 21,
                color: tab === t ? colors.purple : colors.muted,
              }}
            >
              {["⌂", "◷", "▣", "≋", "⚙"][i]}
            </Label>
            <Label
              style={{
                fontSize: 12,
                color: tab === t ? colors.purple : colors.muted,
                fontFamily: "SourceSansBold",
              }}
            >
              {t}
            </Label>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

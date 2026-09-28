import React, { Fragment } from "react";
import { Pressable, View } from "react-native";
import type { Incident } from "./api";
import { Button, Icon, Label, colors, styles as s } from "./ui";

export const eventTime = (value: string | number) =>
  new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
export const clipTime = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

/**
 * The incident's event timeline with playback, matching the web review on a
 * phone: gaps before and after, each camera observation in time order, and the
 * possible continuations between them. Play steps through the events.
 */
export default function Timeline({
  incident,
  cameraName,
  step,
  onSelect,
  playing,
  onPlay,
  video,
}: {
  incident: Incident;
  cameraName: (id: string) => string;
  step: number;
  onSelect: (step: number) => void;
  playing: boolean;
  onPlay: () => void;
  /** Playback position of the selected event's recording, if one is playing. */
  video: { seconds: number; duration: number };
}) {
  const events = incident.observations
    .map((observation, index) => ({ ...observation, index }))
    .sort((a, b) => Date.parse(a.observed_at) - Date.parse(b.observed_at));
  const gap = (event: (typeof events)[number]) => incident.evidence_mode !== "live" && event.location.kind === "unknown";
  const observed = events.filter((event) => !gap(event));
  const order = events.map((event) => event.index);
  const at = order.indexOf(step);
  const first = events.length ? events[0].observed_at : incident.created_at;
  const last = events.length ? events[events.length - 1].observed_at : first;

  const row = (key: string, icon: React.ReactNode, body: React.ReactNode, onPress?: () => void, active = false) => (
    <Pressable
      key={key}
      disabled={!onPress}
      onPress={onPress}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityState={onPress ? { selected: active } : undefined}
      style={({ pressed }) => [
        s.row,
        {
          alignItems: "flex-start",
          padding: 10,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: active ? colors.purple : "transparent",
          backgroundColor: active ? colors.purpleSoft : pressed ? "#f3f2fc" : "transparent",
        },
      ]}
    >
      <View style={{ width: 22, alignItems: "center", paddingTop: 2 }}>{icon}</View>
      <View style={{ flex: 1, gap: 1 }}>{body}</View>
    </Pressable>
  );
  const unknownIcon = <Label style={{ color: colors.muted, fontFamily: "SourceSansBold", fontSize: 15 }}>?</Label>;
  const dot = (active: boolean) => (
    <View style={{ width: 12, height: 12, marginTop: 3, borderRadius: 6, backgroundColor: active ? colors.purple : "#b86c18", borderWidth: 2, borderColor: "#fff" }} />
  );

  return (
    <View style={{ gap: 8 }}>
      <View style={s.row}>
        <View style={{ flex: 1 }}>
          <Label style={s.heading}>Event timeline</Label>
          <Label style={[s.muted, { fontSize: 13 }]}>
            {video.duration > 0
              ? `Video at ${clipTime(video.seconds)} of ${clipTime(video.duration)}`
              : `${observed.length} camera observation${observed.length === 1 ? "" : "s"}`}
          </Label>
        </View>
        <Button small variant="secondary" title="‹" disabled={at <= 0} onPress={() => onSelect(order[at - 1])} />
        <Button small icon={playing ? "pause" : "play"} title={playing ? "Pause" : "Play"} disabled={events.length < 1} onPress={onPlay} />
        <Button small variant="secondary" title="›" disabled={at < 0 || at >= order.length - 1} onPress={() => onSelect(order[at + 1])} />
      </View>
      {events.length > 0 && (
        <View style={{ height: 4, borderRadius: 2, backgroundColor: colors.line, overflow: "hidden" }}>
          <View style={{ height: 4, width: `${((at + 1) / events.length) * 100}%`, backgroundColor: colors.purple }} />
        </View>
      )}
      {events.length === 0 ? (
        <Label style={s.muted}>No observations are available for this visit.</Label>
      ) : (
        <View style={{ gap: 2 }}>
          {row("before", unknownIcon, <>
            <Label style={[s.muted, { fontSize: 12 }]}>Before {eventTime(first)}</Label>
            <Label style={s.strong}>Unknown gap</Label>
            <Label style={[s.muted, { fontSize: 13 }]}>No earlier observation in this visit</Label>
          </>)}
          {events.map((event) => {
            const association = incident.associations.find((item) => item.to_observation_id === event.observation_id);
            const active = step === event.index;
            return (
              <Fragment key={event.observation_id}>
                {association &&
                  row(`link-${event.observation_id}`, <Icon name="link" size={16} color={colors.muted} />, <>
                    <Label style={s.strong}>Possible continuation · {association.unobserved_gap_seconds}s unobserved</Label>
                    <Label style={[s.muted, { fontSize: 13 }]}>Route between cameras is estimated.</Label>
                  </>)}
                {row(event.observation_id, gap(event) ? unknownIcon : dot(active), <>
                  <Label style={[s.muted, { fontSize: 12 }]}>{eventTime(event.observed_at)}</Label>
                  <Label style={s.strong}>{gap(event) ? "Unknown · coverage gap" : `Observed · ${cameraName(event.source_id)}`}</Label>
                  <Label style={[s.muted, { fontSize: 13 }]}>
                    {event.category.replaceAll("_", " ")} · {event.location.kind === "unknown" ? "position unknown" : "position supplied"}
                  </Label>
                  {incident.evidence_mode === "live" && (
                    <Label style={{ fontSize: 13, color: colors.purple, fontFamily: "SourceSansBold" }}>
                      {active && video.duration > 0 ? `Recording ${clipTime(video.duration)}` : "View recording"} ›
                    </Label>
                  )}
                </>, () => onSelect(event.index), active)}
              </Fragment>
            );
          })}
          {row("after", unknownIcon, <>
            <Label style={[s.muted, { fontSize: 12 }]}>After {eventTime(last)}</Label>
            <Label style={s.strong}>Unknown continuation</Label>
            <Label style={[s.muted, { fontSize: 13 }]}>No later camera observation in this visit</Label>
          </>)}
        </View>
      )}
    </View>
  );
}

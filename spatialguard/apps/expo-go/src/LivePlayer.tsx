import React, { useEffect, useRef, useState } from "react";
import { AppState, View } from "react-native";
import { WebView } from "react-native-webview";
import { request, type Device } from "./api";
import { Button, Label, styles } from "./ui";
import { PLAYER_HTML } from "./playerHtml";
export default function LivePlayer({ device }: { device: Device }) {
  const [attempt, setAttempt] = useState(0),
    [active, setActive] = useState(AppState.currentState === "active");
  useEffect(() => {
    const listener = AppState.addEventListener("change", (s) =>
      setActive(s === "active"),
    );
    return () => listener.remove();
  }, []);
  return (
    <View style={{ gap: 10 }}>
      {active ? (
        <Session
          key={device.id + ":" + attempt}
          device={device}
          renew={() => setAttempt((v) => v + 1)}
        />
      ) : (
        <Label>Live view paused while the app is in the background.</Label>
      )}
    </View>
  );
}
function Session({ device, renew }: { device: Device; renew: () => void }) {
  const web = useRef<WebView>(null),
    session = useRef(""),
    disposed = useRef(false),
    stopped = useRef(false),
    offered = useRef(false),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    poll = useRef<ReturnType<typeof setInterval> | undefined>(undefined),
    closing = useRef<Promise<unknown>>(Promise.resolve());
  const [message, setMessage] = useState("Connecting to camera…"),
    [failed, setFailed] = useState(false);
  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    if (poll.current) clearInterval(poll.current);
    const id = session.current;
    session.current = "";
    if (id)
      closing.current = request(
        "/v1/ring/streams/" + encodeURIComponent(id),
        "DELETE",
      ).catch(() => {});
    return closing.current;
  };
  useEffect(
    () => () => {
      disposed.current = true;
      stop();
    },
    [],
  );
  const fail = (message: string) => {
    if (disposed.current) return;
    stopped.current = true;
    setMessage(message);
    setFailed(true);
    web.current?.injectJavaScript('window.receive({kind:"stop"});true;');
    stop();
  };
  return (
    <>
      <View
        style={{
          height: 235,
          backgroundColor: "#151621",
          borderRadius: 9,
          overflow: "hidden",
        }}
      >
        <WebView
          ref={web}
          source={{
            html: PLAYER_HTML,
            baseUrl: "https://spatialguard-production.up.railway.app",
          }}
          originWhitelist={["*"]}
          onShouldStartLoadWithRequest={(r) =>
            r.url === "about:blank" ||
            r.url === "https://spatialguard-production.up.railway.app" ||
            r.url === "https://spatialguard-production.up.railway.app/"
          }
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          javaScriptEnabled
          setSupportMultipleWindows={false}
          onError={() => fail("Video player could not load.")}
          onMessage={async (e) => {
            try {
              if (disposed.current || stopped.current) return;
              const data = JSON.parse(e.nativeEvent.data);
              if (data.kind === "playing") {
                setMessage("Live · video only");
                return;
              }
              if (data.kind === "error") {
                fail(String(data.message));
                return;
              }
              if (
                data.kind !== "offer" ||
                offered.current ||
                typeof data.sdp !== "string" ||
                data.sdp.length > 100000
              )
                return;
              offered.current = true;
              const answer = await request<{
                id: string;
                sdp: string;
                expires_at: number;
              }>(
                "/v1/ring/devices/" +
                  encodeURIComponent(device.id) +
                  "/streams",
                "POST",
                { sdp: data.sdp },
              );
              if (disposed.current || stopped.current) {
                void request(
                  "/v1/ring/streams/" + encodeURIComponent(answer.id),
                  "DELETE",
                ).catch(() => {});
                return;
              }
              session.current = answer.id;
              let checking = false;
              poll.current = setInterval(async () => {
                if (checking || disposed.current || stopped.current) return;
                checking = true;
                try {
                  const state = await request<{ state: string }>(
                    "/v1/ring/streams/" + encodeURIComponent(answer.id),
                  );
                  if (state.state !== "active")
                    fail(
                      "Live session is no longer available. Reconnect to try again.",
                    );
                } catch {
                  fail(
                    "Camera access could not be confirmed. Reconnect to try again.",
                  );
                } finally {
                  checking = false;
                }
              }, 3000);
              web.current?.injectJavaScript(
                "window.receive(" +
                  JSON.stringify({ kind: "answer", sdp: answer.sdp }).replace(
                    /</g,
                    "\\u003c",
                  ) +
                  ");true;",
              );
              timer.current = setTimeout(
                async () => {
                  stopped.current = true;
                  web.current?.injectJavaScript(
                    'window.receive({kind:"stop"});true;',
                  );
                  setMessage("Renewing live session…");
                  await stop();
                  if (!disposed.current) renew();
                },
                Math.max(1000, answer.expires_at * 1000 - Date.now()),
              );
            } catch (error) {
              fail(
                error instanceof Error
                  ? error.message
                  : "Could not open camera.",
              );
            }
          }}
        />
      </View>
      <Label style={styles.muted} accessibilityLiveRegion="polite">
        {message}
      </Label>
      {failed && (
        <Button
          title="Reconnect"
          onPress={() =>
            void stop().then(() => {
              if (!disposed.current) renew();
            })
          }
        />
      )}
    </>
  );
}

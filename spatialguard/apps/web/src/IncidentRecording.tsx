import { useEffect, useState } from "react";
import { incidentRecording } from "./platform";

export default function IncidentRecording({ incidentId, observationId }: {
  incidentId: string; observationId: string;
}) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let disposed = false;
    let media = "";
    setUrl(""); setError("");
    void incidentRecording(incidentId, observationId).then(value => {
      media = value;
      if (disposed) URL.revokeObjectURL(value);
      else setUrl(value);
    }).catch(reason => {
      if (!disposed) setError(reason instanceof Error ? reason.message : "Recording unavailable.");
    });
    return () => { disposed = true; if (media) URL.revokeObjectURL(media); };
  }, [incidentId, observationId, attempt]);
  return <section className="incident-recording" aria-label="Event recording" style={{ width: "100%", minWidth: 0 }}>
    {url && <video src={url} controls playsInline preload="metadata"
      aria-label="Recorded Ring event video" style={{ width: "100%", maxHeight: "45vh", objectFit: "contain" }}
      onError={() => setError("This recording could not play on this device. Try loading it again.")} />}
    <p role="status" style={{ color: "#eeeeee" }}>{error || (url ? "Recorded Ring event · up to 60 seconds · video only" : "Loading event recording from Ring…")}</p>
    {error && <button onClick={() => setAttempt(value => value + 1)}>Retry recording</button>}
  </section>;
}

import { useEffect, useRef, useState } from 'react';
import type { Camera } from '../../../../packages/sdk-typescript';
import type { Marker } from '@twinforge/spatial-view/Map2D';
import type { components } from './generated';
import { incidentRecording, request } from './platform';
import { incidentMovement } from './incidentMovement';
import { samplePersonTrack } from './motionTracking';

type Track = components['schemas']['TestVideoTrack'];
type Classification = components['schemas']['IncidentClassification'];
export default function IncidentRecording({ incidentId, observationId, camera, classification = null, onMovement }: {
  incidentId: string; observationId: string; camera?: Camera;
  classification?: Classification | null; onMovement?: (markers: Marker[]) => void;
}) {
  const [asset, setAsset] = useState({url: '', digest: ''});
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [trackAttempt, setTrackAttempt] = useState(0);
  const [track, setTrack] = useState<Track | null>(null);
  const [trackError, setTrackError] = useState('');
  const [at, setAt] = useState(0);
  const video = useRef<HTMLVideoElement>(null);
  const frame = useRef<number>(0);
  const movementCallback = useRef(onMovement);
  movementCallback.current = onMovement;
  useEffect(() => {
    let disposed = false;
    let media = '';
    setAsset({url: '', digest: ''}); setError(''); setAt(0);
    movementCallback.current?.([]);
    void incidentRecording(incidentId, observationId).then(value => {
      media = value.url;
      if (disposed) URL.revokeObjectURL(media);
      else setAsset(value);
    }).catch(reason => {
      if (!disposed) setError(reason instanceof Error ? reason.message : 'Recording unavailable.');
    });
    return () => { disposed = true; if (media) URL.revokeObjectURL(media); movementCallback.current?.([]); };
  }, [incidentId, observationId, attempt]);
  useEffect(() => {
    let disposed = false;
    setTrack(null); setTrackError('');
    if (!asset.digest || !camera) return;
    void request<Track>(`/v1/incidents/${encodeURIComponent(incidentId)}/observations/${encodeURIComponent(observationId)}/track?clip_digest=${asset.digest}`,
      'GET', undefined, 150000).then(value => {
        if (!disposed) setTrack(value);
      }).catch(reason => { if (!disposed) setTrackError(reason.message || 'Movement analysis unavailable.'); });
    return () => { disposed = true; };
  }, [incidentId, observationId, asset.digest, camera?.id, trackAttempt]);
  useEffect(() => {
    movementCallback.current?.(track && camera ? incidentMovement(track, camera, at, classification) : []);
  }, [track, camera, at, classification]);
  const stop = () => cancelAnimationFrame(frame.current);
  useEffect(() => stop, []);
  const tick = () => {
    const player = video.current;
    if (!player) return;
    setAt(previous => Math.abs(previous - player.currentTime) >= .1 ? player.currentTime : previous);
    if (!player.paused && !player.ended) frame.current = requestAnimationFrame(tick);
  };
  const state = track ? samplePersonTrack(track.points, at).state : null;
  const movementStatus = !camera ? 'Map camera unavailable for this incident.'
    : trackError || (!asset.digest ? 'Movement waits for the recording.' : !track ? 'Analyzing recorded movement…'
      : !track.points.length ? 'No person detected in this recording.'
      : state === 'before' ? 'Person has not appeared yet.'
      : state === 'visible' ? 'Following detected person · estimated map position'
      : 'Person not visible · last observed path retained');
  return <section className="incident-recording" aria-label="Event recording" style={{width: '100%', minWidth: 0}}>
    {asset.url && <video ref={video} src={asset.url} controls playsInline preload="metadata"
      aria-label="Recorded Ring event video" style={{width: '100%', maxHeight: '45vh', objectFit: 'contain'}}
      onPlay={() => { stop(); tick(); }} onPause={() => { stop(); setAt(video.current?.currentTime ?? 0); }}
      onTimeUpdate={() => setAt(video.current?.currentTime ?? 0)} onSeeked={() => setAt(video.current?.currentTime ?? 0)}
      onEnded={() => { stop(); setAt(video.current?.currentTime ?? 0); }}
      onError={() => setError('This recording could not play on this device. Try loading it again.')} />}
    <p role="status" style={{color: '#eeeeee'}}>{error || (asset.url ? 'Recorded Ring event · video only' : 'Loading event recording from Ring…')}</p>
    {asset.url && <p role="status" aria-label="Movement playback status" style={{color: '#eeeeee'}}>{movementStatus}</p>}
    {error && <button onClick={() => setAttempt(value => value + 1)}>Retry recording</button>}
    {trackError && <button onClick={() => { if (trackError.includes('recording changed')) setAttempt(value => value + 1); else setTrackAttempt(value => value + 1); }}>Retry movement</button>}
  </section>;
}

# Recorded incident movement

Every authorized Ring observation in an incident opens its recording and requests
movement analysis automatically. The player clock drives the same estimated path
in 2D and 3D, including pause, backward seeking, and replay. Switching observations
discards the previous player/path. Completed and lost detections retain the path;
there is no invented location beyond the last visible person.

The signed Ring observation remains unchanged, with its original unknown location.
Derived positions are labeled estimates using the displayed camera placement,
heading, range, and field of view. They are not calibrated measurements. The
existing detector follows one primary person; it is not a multi-person identity
tracker. Event classification supplies the actor appearance only when available.
No video bounding boxes are shown.

The backend rechecks owner, site, observation, device mapping, connection generation,
and consent before retrieving/returning media and after analysis. The clip response
has a SHA-256 digest; movement must come from those exact bytes. Replaced clips
require reload. Two bounded clips are reused in server memory for up to two minutes
between requests; the scratch file OpenCV needs is removed after processing or an
exception. Sixteen derived tracks can be reused in memory for ten minutes. These
caches never bypass current authorization. No new database or original-evidence
mutation is involved. Processing is limited to one analysis at a time per API
process, 60 seconds of video, and a 90-second processing deadline.

Missing recording, no person, unavailable detector, and busy analysis have explicit
states. Video playback remains available if movement analysis fails. The browser
and Capacitor Android app use the same component and authenticated API.

Validation on 2026-09-24:

- Real authorized September 24 event: 77 detector samples covering 0–15.86 seconds
  of a 41.77-second recording, analyzed locally in 13.41 seconds. This demonstrates
  detected image movement, not real-world distance accuracy.
- Desktop and phone-sized player tests cover retries, forward/back motion, seeking,
  lost detections, retained paths, and changing the selected incident.
- Backend tests cover exact clip matching, cached authorization, revocation during
  analysis, temporary-file cleanup, and concurrency limits.

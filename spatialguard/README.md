# SpatialGuard local preview

An owner incident workspace for a published TwinForge home. The same React interface runs in a browser and in a bundled Capacitor Android app. The charcoal, gray, and muted-red theme draws from the supplied Figma reference. Synthetic replay remains available, and the local preview can connect a Ring private app to authorized cameras without exposing Ring credentials to the browser or Android client.

Track public-release and competition work in the [10/10, Ring Appstore, and hackathon readiness checklist](docs/10-10-ring-appstore-and-hackathon-checklist.md).

## Run

From the repository root, install the existing Python environment using the TwinForge setup instructions, then install the workspace JavaScript dependencies:

```powershell
npm ci
npm run build --workspace spatialguard-web
```

Start TwinForge if it is not already running:

```powershell
./.venv/Scripts/python.exe scripts/run.py
```

In a second terminal:

```powershell
./.venv/Scripts/python.exe spatialguard/scripts/run.py
```

Open **http://127.0.0.1:8010**. The local browser opens the owner session automatically. The launcher only checks that TwinForge is reachable; places are added by the owner, not at startup. Loading the sample creates a synthetic site through TwinForge's API, publishes the authored fixture, and records that reference, so loading it again reuses the same site. Existing home drafts are untouched.

Choose **Run replay**. The durable worker ingests deterministic observations through TwinForge, queries room membership, and creates one incident. Select observations to inspect their synthetic illustration or unknown coverage gap. Review the incident, switch between 2D and 3D, and select the cameras included in subsequent replay runs.

**Starting out.** With no place yet the app still opens normally — only the **Ground floor** card is empty, offering **Upload floor plan** to trace your own or **Load sample** for the synthetic demo home with its two cameras and replay activity. Whichever place you open last is remembered, so reloading the page or signing in again reopens it instead of starting over. The top bar switches between places once you have more than one. **Settings → Places** removes one, taking its drawing and its incidents with it.

**First-run setup and privacy.** New email accounts open a four-step, skippable guide that explains the separate SpatialGuard and Ring accounts, optional Ring-data and snapshot-classification permissions, floor-plan setup, and the difference between observed evidence and an unknown gap. It can be reopened from Settings. Ring linking, live view, snapshots, device operations, and time-lapse capture require the Ring-data choice; automatic and manual Luna classification also require the separate classification choice. Both start off. The public `/privacy`, `/terms`, and `/data-deletion` pages describe the preview without requiring a session.

Settings can retain incidents for 30, 90, or 365 days and security audit records for 90, 365, or 730 days. The worker applies these periods hourly. **Delete account** requires the current password and the exact word `DELETE`, disconnects Ring first, removes the owner's TwinForge places and drawings, then removes SpatialGuard maps, incidents, evidence, sessions, provider records, and time-lapse files. If Ring or TwinForge cannot complete the upstream removal, the account remains so deletion can be retried instead of silently leaving connected or orphaned data.

**Spatial evidence graph.** A live Ring motion or doorbell webhook establishes which mapped camera observed an event, not where a person stood. The 2D and 3D maps therefore place an amber observation node at each reporting camera. Consecutive cameras inside the five-minute incident window are joined as a dashed **Possible continuation**, with a gray **Unknown gap** in the middle. No live person icon or precise trajectory is drawn without position evidence. Synthetic replay coordinates and explicitly approximate local test-video tracks keep their existing, separately labelled presentation.

**Map from a floor plan.** Choose **Floor plan** in the top bar to trace a PNG or JPEG drawing of one floor into an editable 2D and 3D map. The result is shown for review over your own drawing before anything is added. Tracing runs locally by default; if the TwinForge server has `OPENAI_API_KEY` set, the importer also offers **GPT Sol** to recognise rooms and ignore furniture, which uploads the drawing to OpenAI and bills that account — it is stated in the dialog before the upload, it can be cleared to stay local, and the review step names which engine produced the geometry. If the model is unavailable or returns geometry TwinForge rejects, it falls back to local tracing and says so. The largest space with no readable printed label is named "Living room" as a guess from its size — recorded as a guess, not as something the drawing said.

Accepting asks for two measured dimensions (overall width and depth): tracing only estimates metres from assumed door widths, so a traced plan cannot be published until you measure it, and camera ranges would otherwise be meaningless. The width sets the scale and the depth is an independent check; if they disagree with the drawing by more than 2%, nothing is published. Each import becomes a separate place that the top bar switches between, so the synthetic demo and its replay stay intact. A traced place starts with no cameras, and the replay fixture only matches the demo site, so imported places show coverage but produce no incidents.

**Camera placement.** On the home map, **Add camera** then click the plan to place one. Drag a camera to move it and drag the round handle at the end of its aim line to rotate it; arrow keys nudge a focused camera, Escape cancels a drag. Selecting a camera opens aim and range controls with a **Remove** button, also available on the **Cameras** tab. Every change publishes a new TwinForge revision and repins the site; recorded incidents keep their own revision. Field of view is fixed at Ring's published 110° horizontal lens spec for every camera and is not an owner setting — change `RING_FOV_DEGREES` in `services/api/spatialguard_api/engine.py` to model a different Ring model. The coverage wedge is that lens angle drawn on the floor: it ignores tilt, walls, and occlusion, and it is not evidence of real coverage. A camera you add is not automatically included in replay, and the synthetic fixture only emits observations for the two original demo cameras.

**Luna event classification.** Settings offers an explicit opt-in to classify
up to three authorized Ring snapshots when a motion or doorbell event arrives. SpatialGuard
sends that image to OpenAI's `gpt-5.6-luna`, stores only a short classification,
and discards the image after the request. The result uses cautious labels such as
Possible delivery, Person with face covering, Possible weapon visible, Possible
unauthorized entry, or Unidentified person. It never attempts face recognition,
identity, gender, race, or criminal intent. Every result shows qualitative
confidence, visible evidence, uncertainty, and a review-required notice. If the
snapshot or model is unavailable, the Ring incident still exists and can be
retried from its detail panel. This is event interpretation, not real-time person
tracking, and it does not create a position on the map.

**Private test-video movement replay.** Select a mapped camera on Home, choose
**Test delivery videos**, and play either private clip. The browser follows the
OpenCV 5 / YOLO11 person track and animates a short orange trail on both the 2D
and 3D maps while the video plays. No box is drawn over the private video. The
current marker carries a dashed uncertainty area. Horizontal ground-contact
position is projected through the owner's camera heading and field of view;
vertical ground-contact position supplies a rough near/far cue. Median and
temporal filtering, a walking-speed limit, and 0.22 m trail spacing suppress
detector jitter. This needs no calibration, but it is an estimate rather than a
measured person position. The source videos are served only to the authenticated local owner from
ignored `.data/spatialguard/test-ring-video/`. With classification enabled, opening
a test clip sends six chronological frames from its detected activity interval to
Luna. Otherwise the owner can use the classification button. Frames are decoded
in memory and are not saved; results are reused while switching clips in the current
viewer session. Late responses cannot relabel a different selected clip.
Once classified, the current 2D marker becomes an activity glyph with a name:
yellow overhead courier with a cap and parcel for **Delivery worker**, black silhouette for **Possible
weapon** or **Possible intrusion**, and red silhouette for **Unidentified person**.
The classifier panel states Routine, Review needed, or Urgent review. These are
review priorities, not automatic emergency decisions. SpatialGuard does not infer
man/woman from appearance; a camera image cannot reliably establish gender, and
that inference would add risk without improving the spatial evidence.
Before classification, a detected track says **Person · not classified**, rather
than claiming Luna returned an unidentified person. Home fits the house and active
camera more closely, keeps person symbols around 0.68 map metres wide, and displays
a 2 m layout scale. Zooming never changes geometry or the estimated trajectory.

The replay marker now expires 0.45 seconds after the last person detection and
disappears from both maps, with **No longer visible - position unknown** in the
CCTV status. Gaps longer than 1.25 seconds are not interpolated; after the same
short grace period they show **Detection lost - position unknown** until detection
resumes. Seeking updates the map even while paused, and replay completion hides
the current marker. The accumulated path remains on both 2D and 3D maps after
exit, gaps, seeking and completion; no line joins positions across a detection
gap or a seek. Switching clips/cameras or closing the test source clears the path.
A lost detection may mean exit, occlusion or a detector miss; no path
outside the camera view is invented.

The overhead icon set also distinguishes unidentified person, face covering,
possible weapon, possible intrusion, package, animal, vehicle, unclear activity,
and no relevant activity. Classification icons appear in incident rows, incident
details and the test-video status panel. Face covering stays at review priority;
it does not imply intrusion. Package/animal/vehicle results describe the event,
and do not relabel a detected person's map coordinate as that object. Only person
activity categories change the person track's icon. No relevant activity is not
a claim that the property is safe. These are display mappings, not new detectors.

Stop SpatialGuard and its Ring development tunnel with `./spatialguard/scripts/stop.ps1`. Closing a browser or the Android app does not stop its worker. Stopping the backend stops processing until it is restarted; this preview does not run as a Windows service.

## Ring private-app connection

Keep SpatialGuard running, then start the HTTPS development tunnel:

```powershell
./spatialguard/scripts/ring-tunnel.ps1
```

The script prints the Account Link, App Homepage, Token Exchange, and Webhook URLs. Enter those exact URLs in the private app's Ring developer configuration. A quick-tunnel hostname changes when the tunnel restarts, so update all four portal fields after every restart. Use a named tunnel or hosted HTTPS deployment for a stable installation.

In the Ring Appstore, open the private app, accept its requested scopes, and select only the cameras SpatialGuard should receive. Ring then redirects to SpatialGuard's linking page. The current cross-device fallback uses the one-time code from **Settings → Ring connection**; replacing that fallback with a signed, same-session continuation remains a release requirement. After linking, refresh the Ring cameras and map each authorized device to a placed TwinForge camera. Mapping provides spatial context for future events; Ring motion and doorbell events do not contain calibrated person coordinates and remain labeled as unknown location unless separate observation evidence exists.

The Windows preview encrypts Ring access and refresh tokens with DPAPI under ignored `.data/spatialguard/`. The hosted Railway preview uses a Railway Fernet key and a mounted data volume instead. Email/password accounts use salted scrypt verifiers and Secure, HttpOnly browser sessions; each account has its own sites, incidents, sessions, and Ring connection. See [Railway deployment](RAILWAY_DEPLOYMENT.md) for its required variables. Live view is video-only, time bounded, and not saved as incident evidence. Ring removal and device selection stay in Ring's integration screen.

## Ring operations

The **Operations** destination keeps device health and time-lapse controls separate from incident review. Live viewing belongs to the places where owners already work with cameras:

- **Health** records online/offline transitions observed during Ring inventory refreshes and provider events, shows a rolling seven-day strip, and supports immediate or delayed offline alerts. Browser alerts require permission and run while SpatialGuard is open. Email delivery requires `SPATIALGUARD_SMTP_HOST` and `SPATIALGUARD_SMTP_FROM`; optional SMTP port, user, and password variables are supported. A recovery before the chosen delay suppresses the pending offline notice. This is a convenience monitor, not a security or life-safety service.
- **Camera wall** is the third Home view beside 2D and 3D, and a dedicated mode inside Cameras. It saves one owner-specific order for up to 16 authorized devices, so both entry points remain consistent. Owners explicitly activate one bounded, receive-only Ring media session at a time; the active feed supports zoom, fullscreen, and manual close. SpatialGuard does not silently open or renew every camera. The full Cameras view also shows recent Ring incidents with their source-camera count. Actual availability still depends on the Ring account, device, network, and provider limits. Recorded clip playback stays disabled because the configured official API has not supplied an authorized recording-history route.
- **Time-lapse** schedules still snapshots from a mapped, authorized Ring camera within a daily local-time window. Frames live under ignored `.data/spatialguard/timelapse/`; each project retains the newest 500 frames and can build, download, or share an animated GIF from the newest 120. The scheduler runs only while the local backend is running. It captures no audio and applies no AI.

Python's `tzdata` package is pinned so browser IANA time zones work on Windows as well as Unix systems.

## Android

Requires Android Studio's Java 21 runtime and Android SDK 36. The supplied Windows build script uses their standard installation locations. The app targets Android 36 and supports API 24 and later; actual verification is recorded separately.

```powershell
./spatialguard/scripts/android.ps1 -Install
```

Use one connected, authorized USB device or emulator. The script builds, installs, sets up `adb reverse tcp:8010 tcp:8010`, and launches the app. For a manual install, the debug APK is at `spatialguard/apps/web/android/app/build/outputs/apk/debug/app-debug.apk`.

For the hosted build, sign in on Android with the same verified email and password as the web app. Local development also supports **Settings → Android pairing**: create a code in the web workspace and enter it in Android. The code lasts three minutes and can be redeemed once. Re-establish ADB reverse after reconnecting USB. The PC and both backends must remain running for the local debug connection.

The Android credential is encrypted with an AES-GCM key in Android Keystore. It is never placed in browser storage or the APK. Device sessions can be revoked from Settings. Native logs are disabled to prevent bridge arguments from exposing credentials. Debug and release builds use the hosted Railway HTTPS API by default. Local device testing is opt-in with `-PSPATIALGUARD_DEBUG_API_URL=http://127.0.0.1:8010` plus `adb reverse tcp:8010 tcp:8010`; cleartext remains restricted to that debug loopback destination. Release builds forbid cleartext and take the hosted HTTPS API origin from the `SPATIALGUARD_API_URL` Gradle property or environment variable.

## Boundaries and contracts

- The application API and worker live under `services/api/spatialguard_api`; the app owns its SQLite inbox, runs, incidents, evidence metadata, pairing/session records, and audit entries.
- TwinForge owns geometry and immutable observations. SpatialGuard calls its public SDK/API and stores a published layout snapshot. It never opens TwinForge's database. Engine credentials stay in the Python process, loaded from ignored local credentials or `SPATIALGUARD_TWINFORGE_TOKEN`; `SPATIALGUARD_TWINFORGE_URL` defaults to port 8000.
- `packages/spatial-view` at the repository root contains shared presentation and wall/bounds geometry. TwinForge's editor uses the extracted geometry without acquiring incident or Ring behavior.
- Public API routes cover account privacy/retention choices and deletion, sites, floor-plan import (trace/review/accept/discard), camera placement (add/edit/remove), monitoring, replay runs, incident pagination/detail/review, private evidence, device sessions, and cursor-based event updates. Event polling resumes using `after`; each request rechecks authorization. It uses polling, not an open SSE connection, in this preview. Public browser pages for privacy, terms, and deletion guidance contain no owner data.
- Android API transport, secure storage, lifecycle events, and external-browser behavior are isolated in the platform adapter. Native push and verified app links need the hosted milestone's domain and Firebase setup.

Regenerate SpatialGuard contracts after changing its Pydantic models:

```powershell
./.venv/Scripts/python.exe spatialguard/scripts/contracts.py
npm run contracts --workspace spatialguard-web
```

The generated contract includes references to TwinForge's existing geometry/observation types. TwinForge's own source contracts remain unchanged.

## Verification

```powershell
./.venv/Scripts/python.exe -m pytest spatialguard/tests -q
npm run test --workspace spatialguard-web
```

Browser tests require the local API/worker and TwinForge to be running. They create synthetic replay records in the demo site. Device tests additionally require the debug app installed on the local emulator:

```powershell
cd spatialguard/apps/web
node tests/android-preview.mjs
```

See [verification](docs/verification.md) for observed outcomes and [Ring feasibility](docs/ring-feasibility.md) for the remaining provider gates.

## Current limits

The synthetic preview starts with one owner, one synthetic floor, and two replay cameras (up to eight placed cameras, of which only the two original ones ever produce observations). Hosted accounts use email/password authentication, optional email verification, revocable sessions, password reset, login throttling, and per-owner authorization. Evidence images are authored illustrations, not reconstructed or recorded frames. Replay positions are supplied by the fixture and have no real-camera calibration IDs. Observations retain their fixture timestamps; incident creation time is separate.

The initial incident rule covers supported person observations in Front approach or Hallway. A camera handoff is a possible association between adjacent rooms within 15 seconds, not identity confirmation or a probability. Luna classification examines up to three distinct chronological event snapshots and cannot establish a person's identity, intent, map position, or movement between cameras. Ring may expose fewer distinct snapshots, in which case SpatialGuard classifies the available images. It is opt-in, billed to the configured OpenAI account, and may be wrong; the stored result requires owner review. Test-video trails are browser-local motion estimates, are not TwinForge observations or incident evidence, and disappear when the test source is closed. Monitoring pause or camera changes invalidate queued/in-flight incident creation. Engine ingestion already underway can finish, but a changed monitoring version prevents the incident from being committed. Jobs retry at most three times and recover after their lease expires.

Data persists under the root ignored `.data/spatialguard/` locally or the configured Railway volume. Owners can export account data and delete their account through the UI; deletion returns a non-sensitive receipt. Configured incident and audit retention is enforced, and time-lapse projects have a 500-frame cap and project deletion control. Backup-aware erasure and production restore exercises remain release gates. Web caching is restricted to static shell resources; incidents and evidence are never service-worker cached. Android bundles the shell and requires the backend for data. Browser notifications work only while the web app is open; SMTP email works only when explicitly configured. Hosted mobile push/FCM is not implemented.

The private Ring app has completed account linking, authorized-device discovery, and a successful bounded `1280 x 720` WHEP live view on one real doorbell. A real signed motion/doorbell webhook has not yet been observed, so event delivery remains implemented but unverified. There is no continuous video processing, mobile push delivery, caregiver delegation, identity recognition, or emergency action. Longer real-device performance and Ring certification remain future acceptance gates.

Live Ring events from any number of selected, mapped cameras at one site are grouped when the complete span from the earliest to latest event is no more than five minutes. The window is fixed rather than extended after every event. Observations remain timestamped and camera-specific; consecutive events from different cameras receive only a **possible continuation** association with an explicit unobserved gap. Events from another site, another published revision, or outside the window start a separate incident. A newly appended event reopens a reviewed incident because it contains evidence the owner has not reviewed. Ring event metadata does not establish a person coordinate, so live grouped incidents highlight their source cameras without inventing a route between them.

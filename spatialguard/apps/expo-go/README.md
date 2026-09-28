# SpatialGuard native Expo Go preview

Native React Native screens targeting Expo Go SDK 57. The application no longer
loads the hosted workspace in a WebView. It calls the existing Railway API at
`https://spatialguard-production.up.railway.app` and stores the revocable session
in Expo SecureStore. No backend deployment is needed for this preview.

The current release scope is Android-first for hackathon testing and submission.
The iOS client is intentionally backlog work; do not present it as a supported
platform until it has feature parity and a separate physical-device verification.

## Run on an iPhone from Windows

```powershell
cd spatialguard/apps/expo-go
npm ci
npx expo login
npx expo start --go --port 8083
```

Use the latest Expo Go, sign into the same Expo account, and scan the terminal QR
with the iPhone Camera. Keep the computer and phone on the same Wi-Fi. If LAN
connectivity fails, start with `--tunnel`. The development server must stay running.
SpatialGuard sign-in inside the app is separate from the Expo account.

## Implemented native preview

- House/package welcome artwork, purple theme and bundled Source Sans fonts.
- Native email sign-in, account creation and password-reset request forms.
- Native Home, Cameras, Incidents, Operations and Settings navigation.
- Account session in secure native storage; sign-out revokes the server session.
- Home inventory, monitoring pause/resume and explicit last-refresh timestamp.
- Home map identical to the web app: the web's own 2D map, 3D scene, map controls,
  people heatmap and motion mode, built into a local page (`src/mapEmbedHtml.ts`)
  shown in a WebView. The page has no network access and never sees the session
  token; the native screen fetches the layout, floor-plan drawing and heatmap and
  pushes them in. Tapping a camera opens its live view on Home.
- New activity is polled every few seconds while the app is open, so incidents and
  the motion waves update without a manual refresh.
- Camera thumbnails, camera selection and live-player lifecycle handling.
- Incident pagination, evidence details, classification labels, review and deletion.
- Authorized recorded clips played with expo-video.
- Separate Ring pairing/mapping, home selection, privacy and account pages.
- Read-only camera health, alerts and time-lapse project summary.

## Rebuilding the map page

`src/mapEmbedHtml.ts` is generated from `apps/web/src/embed`. After changing the web
map (`packages/spatial-view`, `MapControls`, `HeatmapView` or the map CSS), run:

```powershell
node scripts/build-map-embed.mjs
```

## Live-video exception

`LivePlayer` embeds a small, bundled HTML video player because native WebRTC is
not included in Expo Go. Only SDP offers/answers and connection status cross the
bridge. Native code performs authorized requests; no account bearer token is
placed in HTML, URLs or browser storage. There is no hosted workspace in that
WebView. App backgrounding and unmounting close the peer and request server stream
deletion. Provider expiry renews a successful session; connection failures show
an explicit Reconnect action. This still needs an actual iPhone/Ring test.

## Verification and current limits

- TypeScript check passed with `npx tsc --noEmit`.
- Expo Doctor: 21/21 checks passed after dependency alignment.
- iOS production JavaScript export compiled successfully.
- Five deterministic player tests cover SDP exchange, close, early unmount,
  playing/disconnect, and connection timeout: `node --test tests/player.test.mjs`.
- Hosted API smoke check passed: iOS bearer sign-in, session inspection, one home,
  and one authorized Ring camera. The temporary verification session was revoked.
- These are build/unit checks, not physical iPhone or real-camera verification.

This is the first native preview, not full Android feature parity. Still pending:
recording-synchronized movement/package rendering, full 3D camera/person artwork,
test-video replay controls, floor-plan import/editing, camera wall, time-lapse
creation/sharing and notification preferences, account deletion/security management,
and a full mobile visual/accessibility pass. Operations is currently read-only.
Incident maps are hidden when the current layout revision differs from the incident
revision; the preview does not substitute a new layout for historical evidence.
Unknown positions remain unknown. No native background push is claimed.

## iPhone acceptance checklist

- [ ] Welcome screen fits without clipping; sign-in remains inside Expo Go.
- [ ] Existing account opens the expected hosted home and cameras.
- [ ] Select a camera and see actual moving live frames (not just an SDP success).
- [ ] Background/resume, switch camera and close video; no abandoned sessions.
- [ ] Observe a successful session renewal and test Reconnect after failure.
- [ ] Open 2D and 3D; check door openings, camera coverage and zoom.
- [ ] Play an available recording; verify a missing clip shows an error.
- [ ] Review persists; deleting only occurs after confirmation.
- [ ] Sign out and confirm the session is no longer usable.

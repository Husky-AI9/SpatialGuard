# SpatialGuard verification record

## September 19, 2026

- Ring Appstore one-way account linking completed for the private app.
- Ring showed the integration as **Active** with one connected device.
- SpatialGuard reported `connected`, refreshed one online **Front Door** Video Doorbell (2nd Gen), and mapped it to `Demo home ? Front camera`.
- The OAuth transport required an explicit partner user agent because Ring's edge rejected Python urllib's default user agent before evaluating the grant. The provider now sends `SpatialGuard-Ring-Partner/1.0`; a regression test covers this behavior.
- A real WHEP session initially failed because this device's valid Ring session URL included the `location` query field. The close-URL validator now accepts only that observed field while retaining its Ring host, camera path, and single-session-segment checks.
- A real live view then rendered from **Front Door** at `1280 x 720`; the browser reported `readyState=4` and active playback. The view was video-only, bounded, and not recorded.
- `12` focused Ring backend tests passed; all `51` SpatialGuard backend tests passed.
- The React/TypeScript production build completed and all `13` Playwright web tests passed. Vite reported only its existing large Three.js chunk advisory.

No real signed motion/doorbell webhook was triggered during this verification. That remains a separate acceptance check.

## September 20, 2026

- The live Ring worker now groups events from any number of mapped cameras at one site into a fixed five-minute incident window.
- Automated coverage verifies three cameras at 0, 150, and 300 seconds produce one incident with two possible-continuation associations and explicit 150-second gaps; an event at 301 seconds starts a new incident.
- Cross-site events remain separate, duplicates remain idempotent, and newly appended evidence reopens a reviewed incident.
- These are synthetic signed-webhook tests. A real multi-camera Ring or official-simulator run has not yet been performed.
- Added the Operations web workspace with device health, saved camera wall, and time-lapse sections. The production TypeScript/Vite build passed.
- Health tests verify delayed offline alerts, suppression when a camera recovers inside the delay, recovery alerts after an offline notice is due, owner-scoped wall persistence, and rejection of unauthorized devices.
- Time-lapse tests verify an authorized mapped-camera capture, owner-scoped frame retrieval, GIF generation, project counting, and data removal. Browser IANA time zones are backed by pinned `tzdata` for Windows.
- All `66` SpatialGuard backend tests passed. All `3` focused Ring web tests passed, including the three-mode Operations workflow.
- Camera-wall concurrency above one real camera, SMTP delivery, real provider online/offline events, and scheduled real-camera time-lapse capture have not yet been verified against Ring. Recorded clip playback remains unavailable without an official authorized history endpoint.

### 3D camera wall attachment

- Corrected presentation snapping to use the rendered solid wall spans on the camera's floor, skipping outdoor slabs and doorway gaps. Mount plates now touch the wall surface and stay clear of wall ends; their height fits the cutaway wall.
- Both SpatialGuard and TwinForge production builds passed (the existing Three.js chunk-size advisory remains).
- All 7 focused camera-mount and tracking tests passed, plus TwinForge's shared-wall/doorway regression. Tests include the front and hallway placements, doorway avoidance, floor isolation, and actual plate vertices touching horizontal, vertical, diagonal and reversed wall faces.
- Browser inspection of the rebuilt local Home 3D map, orbited to both exterior sides, showed both camera housings attached through their plates to solid walls. The front camera is now on the house, not the outdoor approach boundary.
- These are rendering checks, not evidence of real camera calibration or tracking accuracy. Saved camera coordinates and published revisions were not changed.

### Ring hardware models in 3D

- Added original procedural Video Doorbell and Stick Up Cam representations, with black lens panels, layered lenses, speaker perforations, doorbell button, and wall mounts. Product proportions use Ring's [Video Doorbell reference](https://ae-en.ring.com/ar/pages/pdp-video-doorbell-v2) (62 x 126.5 x 28 mm) and [Stick Up Cam reference](https://en-uk.ring.com/products/stick-up-security-camera-battery) (60 x 60 x 97 mm without stand). These are representations, not official CAD files.
- The authorized live Ring inventory returned `name` and `image_url`, with no model field. Its `rvd_gen2_3x.png` product artwork now identifies the front device as `video_doorbell`; refresh through the local API verified this mapping. Unknown artwork stays unknown, and names such as "Front Door" are not used to infer hardware.
- Ring service tests: 19 passed. Model/mount/tracking tests: 9 passed, covering real-scale bounds, wall contact across headings, and camera selection IDs. SpatialGuard production build passed with the existing Three.js chunk advisory.
- Inspected the local map and an enlarged rendering of both models in Chrome. Doorbell uses a flush wedge adapter when angled; Stick Up Cam uses an upright cylindrical body and a circular wall mount. No camera pose or published layout was edited.
- The browser regression for person exit, retained paths, seeking and switching between 2D/3D also passed after introducing the hardware-specific renderer.

### Camera pins in the 3D map

- Added purple camera pins with names, a short leader to the displayed camera mount, and a selected state. Pins follow orbit/zoom at a fixed screen size, remain visible over walls, and hide outside the view. They are navigation markers, not additional physical objects.
- Pins are keyboard-accessible buttons that select the corresponding camera and CCTV card. Selection and workspace refresh preserve the current orbit/zoom when the building extent is unchanged.
- SpatialGuard production build passed. Two browser workflows passed: mouse/keyboard pin selection, preserved zoom and view switching; and existing person-exit/retained-path behavior across 2D/3D. Inspected the resulting screenshot under ignored `.data/spatialguard/3d-camera-pins.png`.

## September 21, 2026 â€” evidence, onboarding, and privacy

- Unknown-location Ring events now render as camera evidence nodes in 2D and 3D. Cross-camera associations use a possible-continuation link with a distinct unknown segment. The browser regression verifies that this live case renders no person actor.
- Added a responsive four-step first-run guide, explicit Ring-data and snapshot-classification choices, configurable incident/audit retention, public privacy/terms/deletion pages, and password-plus-`DELETE` account removal. Email verification and password reset are deferred.
- Backend suite: **75 passed** with the two existing test-harness deprecation warnings. The focused Ring/privacy regression after the final legacy-local scheduler adjustment: **59 passed**.
- Browser suite: **35 passed in 47.4 s**, covering the new graph, phone guide, legal routes, and the existing Ring, replay, camera, activity-icon, and floor-plan workflows.
- SpatialGuard and TwinForge production builds passed with the existing Three.js chunk advisory. Capacitor sync and the Android debug build completed successfully: **154 tasks**, 27 executed and 127 up-to-date.
- Visually inspected `.data/spatialguard/onboarding-phone.png` and `.data/spatialguard/spatial-evidence-graph.png`. These checks use synthetic/mocked events and do not establish person-tracking accuracy, identity matching, or Ring Appstore approval. No Android device or emulator was attached for installation in this run.

## September 21, 2026 â€” release hardening

- Added server-enforced preview/reviewer/certification profiles. The certification profile disables unapproved classification, time-lapse, uptime history, offline alerts, and private test-video tooling unless each feature is explicitly enabled.
- Added hashed, single-use email-verification and password-reset tokens; neutral reset responses; password change; sign-out-all; session activity; granular notification preferences; JSON account export; deletion receipts; and an owner-visible Ring data access log.
- Live incident grouping now stores a digest of its source Ring account and rejects candidates from every other Ring customer account. Site lookup also requires the connected Ring account owner.
- Added sanitized provider-delivery and processing metrics APIs, request correlation, expanded browser security headers, an isolated read-only reviewer mode, a one-command synthetic judge seed, and GitHub CI for contracts, backend, browser, Android, dependency, static, license, secret-history, and Docker checks.
- Verification after the changes: **81 backend tests passed**, **35 Playwright tests passed**, the TypeScript/Vite production build passed, `npm audit --omit=dev --audit-level=high` reported **0 vulnerabilities**, and the Android debug build completed successfully (**154 tasks**, 27 executed).
- These are repository and synthetic/provider-fixture checks. They do not replace Ring certification, real motion-trigger validation, SMTP delivery validation, accessibility review, penetration testing, backup/restore testing, or physical-device testing.

### Mobile-first release and hosted reviewer workspace

- Android now uses the permanent `app.spatialguard.mobile` application ID and version `0.2.0` (code 2). Release builds default to the Railway HTTPS origin; cleartext remains restricted to the debug loopback configuration.
- Added verified Android App Link routes for email verification and password reset, a Railway Digital Asset Links endpoint, release APK/bundle build paths, and environment-only signing configuration. The release APK completed Android lint and assembled successfully; the release signing key and certificate fingerprint remain owner-supplied release inputs.
- Removed the reviewer email, password, and autofill control from the sign-in interface. The private reviewer account remains isolated and must be disabled or have its password rotated before public release.
- Added an immutable TwinForge synthetic demo export for Railway when the separate TwinForge service is unavailable. Tests prove two owners receive distinct site IDs and that replay observations remain pinned to the correct tenant and revision.
- Backend verification after the fallback: **82 tests passed**. The production web build passed. The API 36 emulator passed landing, native signup, Keystore ciphertext inspection, one-time pairing, replay/evidence review, 3D rendering, hardware back, rotation, and background/resume. The automated offline/restart tail did not complete and remains to be rerun; this is not marked as a complete physical-device result.

# SpatialGuard 10/10, Ring Appstore, and Hackathon Readiness Checklist

**Last reviewed:** September 21, 2026  
**Product:** SpatialGuard  
**Current release:** Hosted hackathon preview using a private Ring app  
**Public Ring Appstore status:** Not yet submitted; approval is not guaranteed

This document separates the work needed for a **public Ring Appstore release** from the work needed for the **Build, Ship, Shape: Amazon Developer Hackathon**. The two processes overlap, but neither one substitutes for the other.

## How to use this checklist

- `[x]` means the repository or recorded verification currently provides evidence that the item is complete.
- `[ ]` means evidence is still missing or the work is incomplete.
- **MANUAL** means the owner must use a physical device, inspect the experience, make a business/legal decision, or complete an external portal action.
- **CODEX â€” SOFTWARE** means Codex can implement and test the change in this repository.
- **CODEX â€” DOCUMENT/ASSET** means Codex can draft the document or asset, but the owner must verify facts and approve anything representing the business.
- **EXTERNAL REVIEW** means a qualified third party or Ring must review or approve the item.

Do not check an item merely because a mock, replay, or automated test passed. Add a date, environment, and evidence link beside manual results.

## Mobile-first submission scope

- Android is the primary product and submission experience for this milestone. The hosted Railway web app remains the account, callback, legal, and support companion; a broader public web launch is deferred.
- Ring Appstore certification covers the Ring integration submitted through the Ring Developer Portal. An Android binary distributed through Google Play is a separate review even though both use the same SpatialGuard service.
- [x] **CODEX — SOFTWARE — Build the shared hardened interface into Android.** Account security, certification feature gates, Camera Wall activation, evidence language, export, and deletion controls use the same source as the hosted companion.
- [x] **CODEX — SOFTWARE — Assign the permanent Android application ID `app.spatialguard.mobile`, version code, and release version.**
- [x] **CODEX — SOFTWARE — Pin release networking to the Railway HTTPS API and keep local cleartext access debug-only.**
- [x] **CODEX — SOFTWARE — Add Android App Link routes for email verification and password reset plus a Railway Digital Asset Links endpoint.**
- [x] **CODEX — SOFTWARE — Add repeatable debug, release APK, and signed release-bundle build paths.** Signing secrets remain outside Git.
- [x] **CODEX — SOFTWARE — Remove reviewer credentials and test-account autofill from the mobile and web sign-in UI.**
- [ ] **MANUAL — Add the release signing certificate SHA-256 fingerprint to Railway as `SPATIALGUARD_ANDROID_SHA256_CERT_FINGERPRINT`, redeploy, and verify Android App Links.**
- [ ] **MANUAL — Create and securely back up the release/upload keystore.** Do this before the first store upload; losing the key can prevent future updates.
- [ ] **MANUAL — Run the hardened Android flow on a physical device.** Cover signup, email-link return, password reset, Ring linking, camera live view, account export, deletion receipt, offline recovery, rotation, background/resume, back navigation, and low-memory restart.
- [ ] **MANUAL — Complete Google Play setup if the APK/AAB will also be distributed there.** Finish app signing, store listing, privacy policy, Data safety form, content rating, testing track, and binary review separately from Ring certification.

## Current foundation

- [x] SpatialGuard is deployed over HTTPS at `https://spatialguard-production.up.railway.app/`.
- [x] A real Ring account completed account linking through the official private-app flow.
- [x] Authorized device discovery, a real snapshot, and one bounded live-video session were observed with a physical Ring camera.
- [x] Webhook signature verification, event deduplication, bounded session cleanup, token handling, and replay behavior have automated coverage.
- [x] Ring tokens are encrypted at rest in the hosted deployment and are not shipped to browsers or Android assets.
- [x] The UI distinguishes Replay, Live integration, Observed, Possible continuation, and Unknown gap.
- [x] New accounts receive skippable onboarding and separate Ring-data and snapshot-classification consent choices.
- [x] The app exposes privacy, terms, data-deletion, retention, Ring-disconnect, and account-deletion controls.
- [x] The web production build, Android debug build, TwinForge viewer build, backend tests, and browser tests passed in the September 21 verification run.
- [x] The repository has setup instructions, a license, verification notes, and a Ring developer friction log.

---

# A. Public Ring Appstore approval

## A1. Release blockers and product-policy decisions

These are the highest-risk approval items. Resolve them before spending time on listing artwork.

### Manual, portal, and external work

- [ ] **MANUAL â€” Create a public Ring app.** The current integration is a private app and bypasses public certification. Create a Public App in the Ring Developer Portal after developer identity verification is complete.
- [ ] **MANUAL â€” Confirm the public-app use case with Ring.** Describe SpatialGuard as single-owner, camera-based evidence organization with unknown gaps. Do not describe it as continuous person tracking, identity recognition, intent detection, or guaranteed security.
- [ ] **MANUAL â€” Ask Ring for a written decision on camera uptime history and alerts.** Ring Program Requirement 2.4 prohibits using Ring services to monitor the availability, performance, or functionality of Amazon products or services. A simple current online/offline display is part of Ring's UX guidance, but a seven-day uptime monitor and outage-alert product may conflict with the program requirement.
- [ ] **MANUAL â€” Decide whether to remove uptime history/alerts from the certification build unless Ring approves them in writing.** Preserve the required current online/offline device state.
- [ ] **MANUAL â€” Confirm that sending an opted-in Ring snapshot to OpenAI is permitted.** Record the Ring response, approved purpose, data flow, retention, model-training status, and any territorial limitation.
- [ ] **MANUAL â€” Decide whether the first certification build disables third-party snapshot classification.** Disabling it until written approval is the lower-risk release path.
- [ ] **MANUAL â€” Confirm target territory.** Current Ring Program Requirements limit distribution to the United States unless Ring approves otherwise.
- [ ] **EXTERNAL REVIEW â€” Have privacy counsel review the final privacy policy, terms, consent language, deletion behavior, and camera/AI disclosures.** The existing pages are preview disclosures, not final legal approval.
- [ ] **EXTERNAL REVIEW â€” Obtain an independent security assessment or penetration test.** Keep a remediation record suitable for the Ring privacy and legal questionnaire.

### Codex â€” software work

- [x] **CODEX â€” SOFTWARE â€” Add a certification feature profile.** Use server-side feature flags to disable unapproved uptime history, classification, time-lapse, or other optional processing without forking the product.
- [x] **CODEX â€” SOFTWARE â€” Audit and replace risky labels.** Remove definitive terms such as â€œintruder,â€ â€œarmed,â€ â€œtracked,â€ â€œidentified,â€ or gender guesses from UI, notifications, sample data, screenshots, accessibility labels, and API responses. Prefer â€œperson observed,â€ â€œpossible delivery activity,â€ â€œpossible weapon visible,â€ and â€œreview required.â€
- [x] **CODEX â€” SOFTWARE â€” Remove any live person-path claim from the Ring workflow.** Live Ring events may create camera observation nodes and possible continuations, but must retain unknown locations and gaps unless valid calibration evidence exists.
- [x] **CODEX â€” SOFTWARE â€” Enforce a single Ring-account boundary for every incident and association.** Add tests proving that observations can never be correlated across different Ring customer accounts.
- [x] **CODEX â€” SOFTWARE â€” Add an immutable monitoring/access log visible to the owner.** Show who or what accessed Ring data, which device was used, the purpose, timestamp, and result without exposing tokens or internal device IDs.

### Codex â€” document and asset work

- [ ] **CODEX â€” DOCUMENT â€” Produce a one-page product claims matrix.** For every marketing statement, identify the supporting test and the exact limitation. Treat unsupported accuracy, prevention, safety, and real-time claims as prohibited.
- [ ] **CODEX â€” DOCUMENT â€” Draw the certification data-flow diagram.** Cover Ring â†’ SpatialGuard â†’ Railway storage â†’ optional OpenAI processing, encryption boundaries, retention, deletion, logs, and backups.
- [ ] **CODEX â€” DOCUMENT â€” Create a complete Ring-data inventory.** List every field, purpose, storage location, encryption state, retention period, deletion path, and downstream recipient.
- [ ] **CODEX â€” DOCUMENT â€” Draft the AI governance packet.** Include model/version control, evaluation set, known edge cases, false-positive handling, human review, drift monitoring, feature rollback, and a statement that no Ring data trains SpatialGuard or a third-party model unless specifically authorized.

## A2. Account creation, linking, and first-run experience

### Manual verification

- [ ] **MANUAL â€” Run a clean-account onboarding test.** Use a new SpatialGuard account and a Ring staging user who has never linked the app. Record screen/video evidence from signup through first useful result.
- [ ] **MANUAL â€” Verify staging and production endpoint configurations independently.** Account linking must pass when production URLs are copied into staging, as required before certification.
- [ ] **MANUAL â€” Verify relinking after deliberate Ring revocation.** Confirm stale credentials stop working, the UI explains the cause, and reconnection restores only authorized devices.
- [ ] **MANUAL â€” Verify device removal while its detail or live view is open.** The stream must close, cached data must be retired as required, and the user must return to a safe screen with a clear explanation.
- [ ] **MANUAL â€” Verify expired access and refresh tokens.** Routine access-token refresh should be silent; a truly expired or revoked refresh token should produce a clear relink action.
- [ ] **MANUAL â€” Test setup with at least three non-developer users.** Record completion time, abandon points, confusing copy, and support questions.

### Codex â€” software work

- [x] **CODEX â€” SOFTWARE â€” Provide separate SpatialGuard account signup/sign-in and skippable first-run onboarding.**
- [x] **CODEX â€” SOFTWARE â€” Explain that Ring credentials are entered only in Ring's flow.**
- [x] **CODEX â€” SOFTWARE â€” Show a successful Ring-link confirmation and authorized inventory.**
- [x] **CODEX â€” SOFTWARE â€” Replace copied sign-in codes with a secure signed-in continuation.** Bind the Ring return to the existing owner session, protect it from CSRF, show the account being linked, and retain a safe fallback for cross-device linking. One-use, owner-session-bound continuation and CSRF/origin tests pass (2026-09-21).
- [x] **CODEX â€” SOFTWARE â€” Add email verification and password reset.** Use short-lived, single-use tokens; hashed token storage; rate limits; neutral responses that do not reveal whether an email exists; and transactional-email delivery. This was intentionally deferred from the previous milestone but is required before a serious public launch.
- [x] **CODEX â€” SOFTWARE â€” Add account recovery and session-security UX.** Include password change, â€œsign out all devices,â€ recent security activity, session names, and notification of sensitive account changes.
- [x] **CODEX â€” SOFTWARE â€” Add abuse-resistant authentication controls.** Rate-limit signup/login/reset/link attempts, detect credential stuffing, rotate sessions after authentication, and add CSRF protection to browser mutations.
- [ ] **CODEX â€” SOFTWARE â€” Prefill the signup email from the Ring Users API when permitted.** Keep deferred verification only if the documented Ring pattern applies; otherwise use the verified-email flow.
- [x] **CODEX â€” SOFTWARE â€” Refresh inventory automatically after returning from Ring.** Continue directly into device selection and map placement. The return route opens Settings, refreshes authorized inventory, and is browser-tested (2026-09-21).
- [x] **CODEX â€” SOFTWARE â€” Add device-compatibility checks before setup continues.** Explain unsupported devices and required Ring subscriptions early. Authoritative capability and subscription gates are rendered before mapping/live view (2026-09-21).
- [x] **CODEX â€” SOFTWARE â€” Add Ring-app configuration guidance.** For missing motion events, motion recording, Smart Alerts, motion zones, and privacy zones, explain what is wrong, why it matters, and the exact place to fix it in the Ring app. Customer-safe motion/privacy guidance is derived from device configuration without exposing privacy-zone coordinates (2026-09-21).

### Codex â€” document work

- [ ] **CODEX â€” DOCUMENT â€” Write a reviewer-ready account creation and linking procedure.** It must work without private developer knowledge and fit the Ring certification notes field.
- [ ] **CODEX â€” DOCUMENT â€” Write a customer setup guide and troubleshooting guide.** Cover subscriptions, device compatibility, Smart Alerts, motion zones, offline devices, relinking, and deletion.

## A3. Ring API correctness and real-device lifecycle

### Manual verification

- [ ] **MANUAL â€” Trigger and capture a real signed `motion_detected` webhook end to end.** Record provider request ID, receipt time, signature result, durable acceptance, incident creation, and UI update. This is the largest remaining integration proof gap.
- [ ] **MANUAL â€” Trigger and capture a real `button_press` event if the connected model supports it.**
- [ ] **MANUAL â€” Trigger real `device_online` and `device_offline` transitions.** Verify the current status display without relying on the potentially prohibited uptime-monitor feature.
- [ ] **MANUAL â€” Verify `device_added`, `device_removed`, `app_integration_removed`, `subscription_activated`, and `subscription_deactivated` behavior using staging or physical devices where available.**
- [ ] **MANUAL â€” Verify live session limits on one battery device and one line-powered device.** Confirm the provider timeout, visible countdown/state, explicit close, and cleanup after browser close, backgrounding, network loss, and server restart.
- [ ] **MANUAL â€” Verify two-camera concurrency and the practical camera-wall limit.** Do not claim 16 simultaneous live streams unless Ring, the account, network, browser, and tested devices support it.
- [ ] **MANUAL â€” Confirm all Ring-provided media watermarks remain visible and unmodified.** Test snapshots, live video, and any future clips.
- [ ] **MANUAL â€” Test daylight, night, backlight, offline, slow network, and unavailable-media cases.** Record actual outcomes rather than estimated accuracy.
- [ ] **MANUAL â€” Run a 24-hour staging soak test.** Monitor token refresh, webhook delivery, worker recovery, memory, database growth, stuck sessions, and user-visible stale states.

### Codex â€” software work

- [x] **CODEX â€” SOFTWARE â€” Verify webhook HMAC signatures over the raw request body and deduplicate provider events.**
- [x] **CODEX â€” SOFTWARE â€” Keep provider sessions bounded and support explicit close.**
- [x] **CODEX â€” SOFTWARE â€” Isolate Ring-specific behavior behind the provider adapter.**
- [x] **CODEX â€” SOFTWARE â€” Add a provider event delivery dashboard.** Show sanitized event type, request ID, received/processed state, retry count, and failure reason for owners/admins.
- [x] **CODEX â€” SOFTWARE â€” Add complete webhook lifecycle handling.** Cover all configured events, out-of-order delivery, duplicates, deletion/revocation, subscription loss, poison messages, and bounded retries. Lifecycle, duplicate, ordering, revocation/removal, bounded retry, and dead-letter tests pass (2026-09-21).
- [x] **CODEX â€” SOFTWARE â€” Fetch and enforce Ring privacy zones before displaying, analyzing, or storing frames.** Exclude masked regions without exposing zone coordinates in customer-facing UI. Media fails closed unless privacy state is explicitly clear; coordinates are never returned to the UI (2026-09-21).
- [x] **CODEX â€” SOFTWARE â€” Integrate the Subscriptions Query API.** Display applicable Ring plan/trial state and handle loss of eligibility. If SpatialGuard is paid later, direct purchase/cancellation management to Ring My Apps. Sanitized paid/trial/eligibility state and Ring My Apps guidance are implemented and tested (2026-09-21).
- [x] **CODEX â€” SOFTWARE â€” Make capability discovery authoritative.** Only render live view, snapshots, clips, event history, or other actions when the selected device/account supports them. Live view and snapshots are server-gated by normalized provider capabilities (2026-09-21).
- [x] **CODEX â€” SOFTWARE â€” Reconcile camera-wall behavior with documented session limits.** Add a queue or explicit tile activation instead of uncontrolled renewal and show stale/closed states honestly.
- [x] **CODEX â€” SOFTWARE â€” Add watermark-aware image-processing tests.** Ensure the Ring watermark does not cause false classifications and is never cropped or obscured. Classifier prompt and exact-byte preservation test cover Ring watermark handling (2026-09-21).
- [x] **CODEX â€” SOFTWARE â€” Add production observability.** Structured redacted logs, request correlation, health checks, queue age, webhook latency, failure-rate alerts, and provider-session leak detection. Redacted structured request logs, correlation IDs, health/queue metrics, latency, dead letters, and leak detection are tested (2026-09-21).

## A4. Privacy, deletion, security, and operations

### Manual and external verification

- [ ] **MANUAL â€” Verify the published privacy policy against the actual deployed data flow.** Every data type and third party must match production behavior.
- [ ] **MANUAL â€” Perform a full deletion drill.** Delete an account with a linked Ring account, maps, incidents, time-lapse media, sessions, and classifications; confirm downstream deletion and user confirmation.
- [ ] **MANUAL â€” Define how Railway backups and archived copies satisfy deletion requests.** Current logical deletion does not establish deletion from infrastructure backups.
- [ ] **MANUAL â€” Rotate every credential that was copied into chat, local terminals, screenshots, or old deployment variables.** Confirm old credentials no longer work.
- [ ] **MANUAL â€” Configure a monitored support address, abuse-report channel, security contact, and incident-response owner.** Test that messages receive a response.
- [ ] **EXTERNAL REVIEW â€” Review OpenAI, Railway, email-provider, and analytics contracts/data terms.** Record subprocessors, locations, retention, breach notification, and deletion commitments.
- [ ] **EXTERNAL REVIEW â€” Complete a threat model and penetration test after the production architecture is frozen.** Retest all high/critical findings.

### Codex â€” software work

- [x] **CODEX â€” SOFTWARE â€” Provide separate Ring-data and snapshot-classification consent controls.**
- [x] **CODEX â€” SOFTWARE â€” Provide in-app account deletion and configurable incident/audit retention.**
- [x] **CODEX â€” SOFTWARE â€” Keep Ring credentials server-side and encrypted at rest.**
- [ ] **CODEX â€” SOFTWARE â€” Move production persistence from single-instance SQLite files to managed PostgreSQL and private object storage.** Add migrations, backups, restore testing, per-owner authorization, and deletion jobs. Retain SQLite only for local development.
- [ ] **CODEX â€” SOFTWARE â€” Implement backup-aware deletion.** Define a documented maximum backup-retention window, prevent deleted data from returning during restore, and propagate deletion to every processor and archive.
- [x] **CODEX â€” SOFTWARE â€” Add a user-visible deletion receipt.** Record request time, completion time, categories removed, downstream completion, and a non-sensitive audit reference.
- [x] **CODEX â€” SOFTWARE â€” Add export/access-request support.** Let an owner retrieve the data associated with the account in a documented machine-readable form.
- [x] **CODEX â€” SOFTWARE â€” Add notification preferences with granular channel and frequency controls.** Include operational, incident, summary, and marketing categories; default marketing off.
- [x] **CODEX â€” SOFTWARE â€” Add security headers and production browser protections.** Verify CSP, HSTS, frame restrictions, MIME sniffing protection, referrer policy, secure cookies, CORS/origin rules, and dependency integrity.
- [x] **CODEX â€” SOFTWARE â€” Automate dependency, secret, license, and static security scanning in CI.** Fail releases for committed secrets and unreviewed critical vulnerabilities.
- [x] **CODEX â€” SOFTWARE â€” Add tenant-isolation and authorization fuzz tests.** Include cross-owner object IDs, media URLs, sessions, event streams, deleted accounts, and replay/live boundaries. Random and cross-owner tests cover sites, events, incidents, evidence, sessions, replay, live sessions, and revoked access (2026-09-21).
- [x] **CODEX â€” SOFTWARE â€” Remove sensitive data from logs and error responses.** Add tests for tokens, authorization codes, email addresses, device IDs, snapshots, floor plans, and Ring payloads. Logs use route templates and generated IDs; sanitized validation errors never echo input; redaction tests pass (2026-09-21).
- [x] **CODEX â€” SOFTWARE â€” Add documented incident-response controls.** Credential revocation, forced session logout, provider disconnect, maintenance mode, audit preservation, and user notification hooks. Maintenance mode, forced logout/local Ring invalidation CLI, audit entries, notification hook, and runbook are implemented (2026-09-21).

### Codex â€” documents

- [ ] **CODEX â€” DOCUMENT â€” Replace preview legal pages with final, versioned policies approved by the owner and counsel.** Include effective date, controller/contact, data categories, purposes, legal basis where applicable, subprocessors, transfers, retention, deletion, consent withdrawal, user rights, complaint path, children, and change notice.
- [ ] **CODEX â€” DOCUMENT â€” Create a security overview.** Cover authentication, encryption, secret management, tenant isolation, webhook verification, least privilege, monitoring, backups, vulnerability management, and incident response.
- [ ] **CODEX â€” DOCUMENT â€” Create retention and deletion operating procedures.** Include downstream services and backup expiry.
- [ ] **CODEX â€” DOCUMENT â€” Create an abuse-report and security-report page.** Include expected response windows without promising unsupported guarantees.
- [ ] **CODEX â€” DOCUMENT â€” Maintain a subprocessor list and change-notification process.**

## A5. Product experience and accessibility

### Manual verification

- [ ] **MANUAL â€” Complete a WCAG 2.2 AA audit on desktop and mobile.** Test keyboard-only navigation, screen readers, focus order, 200%/400% zoom, contrast, reduced motion, captions, and error announcements.
- [ ] **MANUAL â€” Test the web app on current Chrome, Edge, Safari, and Firefox, plus Android Chrome and the packaged Android app.**
- [ ] **MANUAL â€” Test the Android release on a physical device.** Cover install, first launch, rotation, back navigation, background/resume, offline recovery, camera permission behavior if any, external links, and low-memory restart.
- [ ] **MANUAL â€” Conduct five task-based usability sessions.** Measure whether users can link Ring, choose a camera, understand an incident, explain an unknown gap, review/delete data, and recover from an offline camera without coaching.
- [ ] **MANUAL â€” Verify every empty, loading, stale, offline, denied, revoked, expired, and server-error state.** No blank panels or generic internal errors.

### Codex â€” software and design work

- [x] **CODEX â€” SOFTWARE â€” Provide responsive navigation, camera views, incident review, 2D/3D views, and an evidence graph.**
- [x] **CODEX â€” SOFTWARE â€” Keep camera observations and uncertain continuations visually distinct.**
- [x] **CODEX â€” SOFTWARE â€” Complete keyboard and screen-reader semantics for the map, camera wall, incident timeline, dialogs, and 3D controls.** Provide an equivalent text evidence timeline for spatial visuals. Map/3D labels and keyboard camera controls, text evidence timeline, keyboard wall ordering, and trapped/restored dialog focus are browser-tested (2026-09-21).
- [x] **CODEX â€” SOFTWARE â€” Add reduced-motion and low-power modes.** Keep the core incident-review experience useful without WebGL or animation. Low-power disables WebGL while retaining 2D/timeline; reduced-motion behavior is browser-tested (2026-09-21).
- [x] **CODEX â€” SOFTWARE â€” Add polished recovery states.** A shared, responsive recovery notice explains the cause, the stale/unavailable-data effect, and the next action for workspace, Ring, camera inventory, camera wall, operations, onboarding, and floor-plan failures. Retry actions are included where the operation is safely repeatable and browser-tested (2026-09-21).
- [x] **CODEX â€” SOFTWARE â€” Add notification history and status.** Users should see what was sent, suppressed, delayed, or failed.
- [x] **CODEX â€” SOFTWARE â€” Remove developer and hackathon terminology from the production customer flow.** Retain it only in reviewer/demo mode. Customer routes and error copy use production language; provenance labels remain explicit (2026-09-21).
- [ ] **CODEX â€” SOFTWARE â€” Run visual regression tests across supported breakpoints.** Cover onboarding, home, incidents, cameras, settings, legal pages, camera wall, 2D, and 3D.

## A6. Public listing, certification, and rollout

### Manual and portal work

- [ ] **MANUAL â€” Complete Amazon/Ring developer identity verification.**
- [ ] **MANUAL â€” Configure the Public App with least-privilege scopes and separate staging/production HTTPS endpoints.**
- [ ] **MANUAL â€” Keep the production endpoints stable throughout review.** Monitor logs and respond promptly to reviewer traffic/questions.
- [ ] **MANUAL â€” Complete all five Privacy & Legal Questionnaire tabs.** General, Data processing, AI governance, Data protection, and Third parties must match the deployed build.
- [ ] **MANUAL â€” Paste and verify reviewer notes for account creation, Ring account linking, and the end-to-end test scenario.** Each portal field allows 20â€“4000 characters.
- [ ] **MANUAL â€” Submit only after testing account linking with both staging and production endpoint configurations.**
- [ ] **MANUAL â€” Start with an invite-only beta, then use a controlled rollout after telemetry and support results are acceptable.**
- [ ] **MANUAL â€” Define a recertification trigger.** Privacy-policy changes, new data uses, AI changes, third-party changes, and material feature changes may require review again.

### Codex â€” documents and assets

- [ ] **CODEX â€” DOCUMENT/ASSET â€” Create the final Ring Appstore listing package:**
  - [ ] Public name: 7â€“30 characters and distinct from Ring/Amazon trademarks.
  - [ ] 1024Ã—1024 PNG/JPEG icon under 2 MB that works on light and dark backgrounds.
  - [ ] Short description up to 125 characters.
  - [ ] Detailed description up to 500 characters.
  - [ ] Category selection and latest-release notes up to 300 characters.
  - [ ] Main image plus 1â€“5 accurate product images, recommended 1024Ã—1024 and under 2 MB each.
  - [ ] Optional MP4 up to 30 seconds, at least 720p and under 5 MB, plus thumbnail.
  - [ ] Features up to 400 characters and requirements up to 500 characters.
  - [ ] Supported customer/device/camera compatibility selections.
  - [ ] Developer information, website, support, privacy, and terms URLs.
- [ ] **CODEX â€” DOCUMENT â€” Draft the three certification reviewer-note answers and an end-to-end expected-results table.**
- [ ] **CODEX â€” DOCUMENT â€” Create an Appstore setup walkthrough and support knowledge base.**
- [ ] **CODEX â€” DOCUMENT â€” Prepare release notes, rollback instructions, and a post-release monitoring checklist.**
- [ ] **CODEX â€” DOCUMENT â€” Review all Ring brand usage against current Ring Appstore Marketing Guidelines.** Send any press release or integration-focused marketing video for Ring PR approval 10â€“12 business days before publication when the guidelines require it.

### Ring Appstore approval definition of done

- [ ] Public App exists and all configured scopes/endpoints are final.
- [ ] No unresolved program-policy conflict remains for uptime monitoring, AI processing, surveillance language, or data deletion.
- [ ] Real webhook, revocation, removal, subscription, token, and session lifecycle evidence is attached.
- [ ] Privacy zones are respected before any frame display, analysis, or storage.
- [ ] Production authentication, recovery, security monitoring, support, and backup-aware deletion are operational.
- [ ] Accessibility, physical-device, cross-browser, usability, penetration, and soak tests have signed results.
- [ ] Listing assets, legal pages, reviewer instructions, questionnaire, and demo account are final and consistent.
- [ ] Ring has certified the submitted version. Only Ring can check this final box.

---

# B. Build, Ship, Shape: Amazon Developer Hackathon

**Submission deadline:** October 23, 2026 at 12:00 PM Pacific Time. Recheck the Devpost rules immediately before submission.  
**Primary track:** Ring  
**Judging:** Stage One is pass/fail for fit and meaningful required-technology use. Stage Two scores Tech Implementation, Design, Potential Impact, and Quality of the Idea equally. A strong friction log can add up to a 10% bonus.

## B1. Mandatory eligibility and submission requirements

### Manual and Devpost work

- [ ] **MANUAL â€” Confirm every entrant is eligible.** Check age of majority, residence/location restrictions, employer/sponsor conflicts, and team authorization in the official rules.
- [ ] **MANUAL â€” Join the hackathon on Devpost and choose the Ring primary track.**
- [ ] **MANUAL â€” Select mini challenges only when the project qualifies.** The current Railway deployment does not qualify for the AWS Builder mini challenge by itself. The Open Source mini challenge requires a new additional public project or a meaningful contribution made during the event, with its own contribution URL and required explanation.
- [ ] **MANUAL â€” Decide whether the repository will be public or private for judging.**
  - [ ] If public, keep an OSI-style license visible and remove all private data/secrets.
  - [ ] If private, invite `testing@devpost.com` and the Amazon GitHub reviewers named in the rules: `chris-trag`, `knmeiss`, `giolaq`, `anishamalde`, `mosesroth`, and `emersonsklar`.
- [ ] **MANUAL â€” Keep the hosted app free and available to judges through the end of judging.** Set a Railway budget alert and monitor uptime without exposing private camera access.
- [ ] **MANUAL â€” Put fresh judge credentials and exact testing instructions in the private submission field.** Do not commit the password or publish it in screenshots/video.
- [ ] **MANUAL â€” Record a public YouTube or Vimeo demonstration shorter than three minutes.** Show the intended platform and an actual Ring device or official simulator working.
- [ ] **MANUAL â€” Verify the demo contains no private home details, tokens, email addresses, license plates, faces without consent, copyrighted music, or unapproved third-party assets/trademarks.**
- [ ] **MANUAL â€” Complete every Devpost field in English.** Include the text description, repository URL, public video URL, primary track, tools/APIs used, product feedback, and testing instructions.
- [ ] **MANUAL â€” Submit before the deadline and independently reopen every URL from a signed-out browser.** Save a submission receipt and screenshots.

### Codex â€” software and repository work

- [x] **CODEX â€” SOFTWARE â€” The running project calls Ring account-linking, inventory, snapshot, and WHEP APIs at runtime rather than merely naming Ring in documentation.**
- [x] **CODEX â€” SOFTWARE â€” The repository contains source code, a license, setup instructions, verification notes, and a hosted deployment path.**
- [x] **CODEX â€” SOFTWARE â€” Add a one-command judge demo seed/reset.** It must preserve the test account, use sanitized synthetic content, and never connect judges to the owner's real Ring camera.
- [x] **CODEX â€” SOFTWARE â€” Add a read-only demo mode if Ring staging access is unavailable.** Label it Replay and keep the live-integration proof separate.
- [x] **CODEX â€” SOFTWARE â€” Add a public `/status` or reviewer diagnostics page.** Show sanitized service health, deployment version, enabled evidence mode, and dependency availability without secrets.
- [x] **CODEX â€” SOFTWARE â€” Run a clean clone/install/build/test on a machine or container without developer state.** A detached clean worktree without `.env`, `.data`, prior dependencies, or uploads passed locked installation, 95 backend tests (1 skipped), production web build, contract regeneration, and the production dependency audit. The run found and fixed missing local SDK paths in the contract generator; exact durations and limits are recorded in `docs/release-verification-2026-09-21.md` (2026-09-21).
- [x] **CODEX â€” SOFTWARE â€” Add CI for backend tests, frontend type/build/browser tests, Android build, contract generation drift, secret scan, and license checks.**
- [x] **CODEX â€” SOFTWARE â€” Remove all private files and generated artifacts from Git history, not only the current working tree.** Verify with secret/history scanning before granting judges access. All 21 commits were scanned by path and secret patterns; no private media/database/credential paths or key-pattern hits were found (2026-09-21).

### Codex â€” documents and assets

- [ ] **CODEX â€” DOCUMENT â€” Create `JUDGES.md`.** Include a five-minute test path, credentials location, expected results, replay/live labels, limitations, troubleshooting, and support contact.
- [ ] **CODEX â€” DOCUMENT â€” Create a submission-period change log.** Clearly distinguish the pre-August-31 baseline from substantial work completed during the hackathon window.
- [ ] **CODEX â€” DOCUMENT â€” Produce a software bill of materials and third-party attribution list.** Confirm licenses for icons, 3D assets, fonts, screenshots, test video, OpenCV/model weights, and generated imagery.
- [ ] **CODEX â€” DOCUMENT â€” Draft the Devpost description and product-feedback answers.** Explain what Ring tools were used, what worked, what needs improvement, onboarding experience, and whether the team would build with them again.
- [x] **CODEX â€” DOCUMENT â€” Maintain a Ring developer friction log with task, steps, expected/actual behavior, severity, workaround, and actionable suggestion.**
- [ ] **CODEX â€” DOCUMENT â€” Edit the friction log for submission.** Remove sensitive details, add evidence dates, prioritize the strongest entries, and ensure each claim is reproducible.

## B2. Tech Implementation â€” 10/10 target

### Manual verification

- [ ] **MANUAL â€” Capture the real signed motion-event proof.** A real physical trigger should reach the hosted webhook, create a durable camera observation/incident, and update the UI.
- [ ] **MANUAL â€” Demonstrate at least two camera sources.** Best: two physical Ring cameras. Acceptable fallback: one real Ring camera plus the official Ring simulator, with each source labeled accurately. A synthetic SpatialGuard replay is useful evidence but does not prove a second Ring integration.
- [ ] **MANUAL â€” Perform the complete demo twice without intervention.** Measure event-to-UI latency and confirm no duplicate incidents.
- [ ] **MANUAL â€” Demonstrate one honest failure path.** For example, revoke access or take a camera offline and show the gap/recovery state.

### Codex â€” software work

- [x] **CODEX â€” SOFTWARE â€” Turn the live Ring event into the same explainable evidence model used by replay.** Persist provenance, event time, source camera, revision, evidence mode, and unknown location.
- [x] **CODEX â€” SOFTWARE â€” Add measurable pipeline telemetry.** Report webhook acknowledgment latency, queue latency, incident creation latency, duplicate suppression, error rate, and recovery time. Webhook acknowledgment, queue, incident, duplicate, error, recovery, and leak metrics are implemented and tested (2026-09-21).
- [x] **CODEX â€” SOFTWARE â€” Pin and document every production dependency/model version.** Make the demo reproducible. Lockfiles, runtime pins, model configuration, and reproducible build guide are present (2026-09-21).
- [x] **CODEX â€” SOFTWARE â€” Keep TwinForge and SpatialGuard boundaries enforceable in tests.** SpatialGuard must consume the public API/SDK and never read TwinForge's database. AST boundary tests prohibit TwinForge DB/internal imports and require the SDK/API boundary (2026-09-21).

## B3. Design â€” 10/10 target

### Manual verification

- [ ] **MANUAL â€” Run five usability sessions on the three-minute story.** A participant should answer: what happened, which camera observed it, what is only possible, and what is unknown.
- [ ] **MANUAL â€” Test the exact demo on the recording computer, a phone, and a physical Android device.**
- [ ] **MANUAL â€” Review every screen at presentation zoom and in poor network conditions.** Fix cropped content, unreadable labels, layout jumps, and dead controls.

### Codex â€” software/design work

- [x] **CODEX â€” SOFTWARE â€” Make the Spatial Evidence Graph the visual center of the product.** Camera wall, time-lapse, and uptime status should support the story rather than dilute it.
- [x] **CODEX â€” SOFTWARE â€” Add a concise evidence inspector.** Selecting a node should show timestamp, camera name, evidence mode, associated media availability, triggering rule, certainty language, and revision. Timestamp, camera, evidence mode, media, rule, certainty, and full revision are implemented and browser-tested (2026-09-21).
- [x] **CODEX â€” SOFTWARE â€” Make unknown gaps understandable without reading documentation.** Use consistent legend, line treatment, hover/focus explanation, and text equivalent.
- [ ] **CODEX â€” SOFTWARE â€” Complete a visual polish pass.** Harmonize spacing, typography, controls, loading skeletons, motion, chart/map density, and empty/error states across web and Android.
- [ ] **CODEX â€” SOFTWARE â€” Meet WCAG 2.2 AA for the judged workflow.** Automated axe-core WCAG 2 A/AA, 2.1 AA, and 2.2 AA checks now pass for the landing, authentication, legal, desktop workspace, and phone workspace; keyboard/dialog/equivalent-timeline tests also pass. Keep this open until manual screen-reader, 200% zoom, reflow, and physical-device checks are recorded.

## B4. Potential Impact â€” 10/10 target

### Manual research

- [ ] **MANUAL â€” Interview at least five multi-camera Ring owners.** Record their current review workflow, time spent, mistakes, trust concerns, and willingness to try SpatialGuard.
- [ ] **MANUAL â€” Run a timed comparison.** Give participants the same event using a camera-by-camera baseline and SpatialGuard; measure time to reconstruct, errors, and confidence without leading them.
- [ ] **MANUAL â€” Obtain two concise user quotes with permission for the submission.** Do not fabricate testimonials.
- [ ] **MANUAL â€” Define the first realistic customer segment and price hypothesis.** Keep the initial claim narrow, such as owners with several cameras reviewing one property.

### Codex â€” documents and analysis

- [ ] **CODEX â€” DOCUMENT â€” Create a competitor/problem comparison.** Focus on separate-camera review versus spatial evidence and uncertainty; avoid unsupported claims that Ring lacks capabilities.
- [ ] **CODEX â€” DOCUMENT â€” Summarize user-study results with sample size and limitations.** Do not present a tiny study as market validation.
- [ ] **CODEX â€” DOCUMENT â€” Create a credible deployment/cost model.** Estimate per-owner storage, event volume, inference cost, streaming load, support burden, and Railway/AWS scale path.
- [ ] **CODEX â€” DOCUMENT â€” Define success metrics.** Setup completion, linked-device success, webhook delivery, incident review time, false-label correction, retention/deletion completion, and support rate.

## B5. Quality of the Idea â€” 10/10 target

### Manual positioning decisions

- [ ] **MANUAL â€” Commit to one flagship message:** â€œSpatialGuard organizes authorized multi-camera events into a reviewable spatial evidence graph while preserving what the cameras did not establish.â€
- [ ] **MANUAL â€” Keep the primary demo on the creative Ring criteria.** Show a multi-camera pipeline and event-based behavior, not merely a motion alert or live-view grid.
- [ ] **MANUAL â€” Decide which secondary features to omit from the three-minute submission.** Camera wall, uptime, and time-lapse can make the product feel unfocused when they do not support the flagship story.

### Codex â€” software and documents

- [x] **CODEX â€” SOFTWARE â€” Provide a polished before/after comparison mode.** Show the old camera-by-camera evidence list beside the SpatialGuard evidence graph using the same event. The same event renders camera-by-camera and spatial evidence views side by side (2026-09-21).
- [x] **CODEX â€” SOFTWARE â€” Make uncertainty a useful interaction.** Let the reviewer inspect why a continuation is possible, which time/adjacency facts support it, and which missing evidence prevents a stronger claim. Possible continuations expose supporting timing facts and missing route/identity evidence (2026-09-21).
- [ ] **CODEX â€” DOCUMENT â€” Explain why TwinForge is reusable infrastructure rather than a decorative 3D model.** Connect immutable revisions, camera placement, spatial queries, and provenance directly to incident trust.
- [ ] **CODEX â€” DOCUMENT â€” State the ethical boundary as a product advantage.** No face recognition, cross-account identity, continuous route invention, gender inference, automatic accusation, or emergency dispatch.

## B6. Demo and submission package

### Manual recording and submission

- [ ] **MANUAL â€” Record the final video only after the exact hosted build is frozen.**
- [ ] **MANUAL â€” Keep the video under 2:50 to leave margin below the three-minute limit.** Judges are not required to watch past three minutes.
- [ ] **MANUAL â€” Add captions and verify readability on a phone.**
- [ ] **MANUAL â€” Show the physical Ring trigger or official simulator, hosted UI update, evidence graph, evidence inspection, unknown gap, review action, and one failure/revocation state.**
- [ ] **MANUAL â€” Upload publicly to YouTube or Vimeo and test playback signed out.**
- [ ] **MANUAL â€” Submit at least 24 hours early.** Recheck repo access, judge login, hosted URL, video, screenshots, and every required field.

### Codex â€” documents and assets

- [ ] **CODEX â€” DOCUMENT â€” Write the final 2:45 narration and shot list.**
- [ ] **CODEX â€” DOCUMENT/ASSET â€” Capture final screenshots:** landing page, onboarding, live camera/device status, spatial evidence graph, incident detail, unknown gap, privacy controls, and phone layout.
- [ ] **CODEX â€” DOCUMENT â€” Draft the final Devpost copy around the four equal criteria.** Lead with the customer problem and live Ring proof.
- [ ] **CODEX â€” DOCUMENT â€” Prepare a concise limitations section.** Separate physical-device results, official simulator results, synthetic replay, and unverified behavior.
- [ ] **CODEX â€” DOCUMENT â€” Prepare a submission-day verification record with timestamped URLs, commit SHA, deployed version, test results, and backup contact.**

### Hackathon submission definition of done

- [ ] Stage One fit is obvious from the repository and first 20 seconds of the video.
- [ ] A real Ring device or official simulator is visibly used at runtime.
- [ ] The private/public repository is accessible to every required reviewer and contains no secrets or private user media.
- [ ] The hosted app, judge account, and reset path work from a clean signed-out browser.
- [ ] The video is public, under three minutes, captioned, and shows the actual target platform.
- [ ] The write-up covers features, Ring technology, significant in-window work, product feedback, testing, limitations, and primary track.
- [ ] The friction log is included for the possible bonus.
- [ ] Tech Implementation, Design, Potential Impact, and Quality of the Idea each have concrete evidence.
- [ ] Submission is completed before October 23, 2026 at 12:00 PM Pacific and the receipt is saved.

---

# C. Recommended execution order

## Before the hackathon submission

- [ ] **1. Real Ring proof:** capture a signed real motion event and a complete end-to-end incident.
- [ ] **2. Submission focus:** freeze the flagship evidence-graph story and remove unrelated features from the short demo.
- [ ] **3. Judge reliability:** add demo reset, judge instructions, clean-install proof, CI, and hosted diagnostics.
- [ ] **4. Design proof:** finish the evidence inspector, accessibility of the judged path, mobile layout, and failure states.
- [ ] **5. Impact proof:** complete user interviews and the timed camera-by-camera comparison.
- [ ] **6. Submission assets:** prepare the video, screenshots, Devpost copy, product feedback, friction log, and reviewer access.

## After hackathon submission, before Ring certification

- [ ] **1. Resolve policy blockers:** uptime monitoring, third-party AI processing, surveillance wording, and United States distribution.
- [ ] **2. Finish production identity:** email verification, password reset, account recovery, and abuse controls are implemented; the secure Ring linking continuation remains.
- [ ] **3. Finish Ring compliance:** privacy zones, subscription state, complete lifecycle handling, capability gating, and reviewer test flow.
- [ ] **4. Finish production data operations:** PostgreSQL/object storage, backup-aware deletion, export requests, subprocessors, and incident response.
- [ ] **5. Complete assurance:** physical-device matrix, accessibility, usability, soak, penetration, disaster-recovery, and deletion tests.
- [ ] **6. Complete public listing and legal review:** metadata, media, support, final policies, questionnaire, reviewer notes, beta plan, and certification submission.

---

# D. Authoritative sources

Recheck these sources before certification or submission because requirements can change.

## Ring

- [Getting Started with Ring Developer Experience](https://developer.amazon.com/docs/ring/get-started.html)
- [Configure Your Ring Application](https://developer.amazon.com/docs/ring/configure.html)
- [Ring API Development Guide](https://developer.amazon.com/docs/ring/develop.html)
- [Certify Your Ring Application](https://developer.amazon.com/docs/ring/certify.html)
- [Publish Your Ring Application](https://developer.amazon.com/docs/ring/publish.html)
- [Your App Design Guide for Ring Customer Experiences](https://developer.amazon.com/docs/ring/ux-design-guide.html)
- [Ring Appstore Program Requirements](https://developer.amazon.com/docs/ring/program-requirements.html)
- [Ring Appstore Permitted Content Policy](https://developer.amazon.com/docs/ring/content-policy.html)
- [Ring Developer FAQ and Certification Best Practices](https://developer.amazon.com/docs/ring/developer-faq.html)

## Hackathon

- [Build, Ship, Shape: Amazon Developer Hackathon](https://amazonappdev2026.devpost.com/)
- [Official rules](https://amazonappdev2026.devpost.com/rules)
- Local copy supplied by the project owner: `C:\Users\Kurst\.codex\attachments\f72fb462-f4ba-4bb8-b6d0-89839893e54d\pasted-text.txt`

## Project evidence

- `spatialguard/docs/verification.md`
- `spatialguard/docs/ring-feasibility.md`
- `spatialguard/docs/hosted-ring-link-verification.md`
- `spatialguard/Ring Developer Friction Log.txt`
- `spatialguard/README.md`
- `docs/known-limits.md`

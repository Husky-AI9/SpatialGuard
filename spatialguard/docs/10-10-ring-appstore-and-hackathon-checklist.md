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
- **CODEX — SOFTWARE** means Codex can implement and test the change in this repository.
- **CODEX — DOCUMENT/ASSET** means Codex can draft the document or asset, but the owner must verify facts and approve anything representing the business.
- **EXTERNAL REVIEW** means a qualified third party or Ring must review or approve the item.

Do not check an item merely because a mock, replay, or automated test passed. Add a date, environment, and evidence link beside manual results.

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

- [ ] **MANUAL — Create a public Ring app.** The current integration is a private app and bypasses public certification. Create a Public App in the Ring Developer Portal after developer identity verification is complete.
- [ ] **MANUAL — Confirm the public-app use case with Ring.** Describe SpatialGuard as single-owner, camera-based evidence organization with unknown gaps. Do not describe it as continuous person tracking, identity recognition, intent detection, or guaranteed security.
- [ ] **MANUAL — Ask Ring for a written decision on camera uptime history and alerts.** Ring Program Requirement 2.4 prohibits using Ring services to monitor the availability, performance, or functionality of Amazon products or services. A simple current online/offline display is part of Ring's UX guidance, but a seven-day uptime monitor and outage-alert product may conflict with the program requirement.
- [ ] **MANUAL — Decide whether to remove uptime history/alerts from the certification build unless Ring approves them in writing.** Preserve the required current online/offline device state.
- [ ] **MANUAL — Confirm that sending an opted-in Ring snapshot to OpenAI is permitted.** Record the Ring response, approved purpose, data flow, retention, model-training status, and any territorial limitation.
- [ ] **MANUAL — Decide whether the first certification build disables third-party snapshot classification.** Disabling it until written approval is the lower-risk release path.
- [ ] **MANUAL — Confirm target territory.** Current Ring Program Requirements limit distribution to the United States unless Ring approves otherwise.
- [ ] **EXTERNAL REVIEW — Have privacy counsel review the final privacy policy, terms, consent language, deletion behavior, and camera/AI disclosures.** The existing pages are preview disclosures, not final legal approval.
- [ ] **EXTERNAL REVIEW — Obtain an independent security assessment or penetration test.** Keep a remediation record suitable for the Ring privacy and legal questionnaire.

### Codex — software work

- [ ] **CODEX — SOFTWARE — Add a certification feature profile.** Use server-side feature flags to disable unapproved uptime history, classification, time-lapse, or other optional processing without forking the product.
- [ ] **CODEX — SOFTWARE — Audit and replace risky labels.** Remove definitive terms such as “intruder,” “armed,” “tracked,” “identified,” or gender guesses from UI, notifications, sample data, screenshots, accessibility labels, and API responses. Prefer “person observed,” “possible delivery activity,” “possible weapon visible,” and “review required.”
- [ ] **CODEX — SOFTWARE — Remove any live person-path claim from the Ring workflow.** Live Ring events may create camera observation nodes and possible continuations, but must retain unknown locations and gaps unless valid calibration evidence exists.
- [ ] **CODEX — SOFTWARE — Enforce a single Ring-account boundary for every incident and association.** Add tests proving that observations can never be correlated across different Ring customer accounts.
- [ ] **CODEX — SOFTWARE — Add an immutable monitoring/access log visible to the owner.** Show who or what accessed Ring data, which device was used, the purpose, timestamp, and result without exposing tokens or internal device IDs.

### Codex — document and asset work

- [ ] **CODEX — DOCUMENT — Produce a one-page product claims matrix.** For every marketing statement, identify the supporting test and the exact limitation. Treat unsupported accuracy, prevention, safety, and real-time claims as prohibited.
- [ ] **CODEX — DOCUMENT — Draw the certification data-flow diagram.** Cover Ring → SpatialGuard → Railway storage → optional OpenAI processing, encryption boundaries, retention, deletion, logs, and backups.
- [ ] **CODEX — DOCUMENT — Create a complete Ring-data inventory.** List every field, purpose, storage location, encryption state, retention period, deletion path, and downstream recipient.
- [ ] **CODEX — DOCUMENT — Draft the AI governance packet.** Include model/version control, evaluation set, known edge cases, false-positive handling, human review, drift monitoring, feature rollback, and a statement that no Ring data trains SpatialGuard or a third-party model unless specifically authorized.

## A2. Account creation, linking, and first-run experience

### Manual verification

- [ ] **MANUAL — Run a clean-account onboarding test.** Use a new SpatialGuard account and a Ring staging user who has never linked the app. Record screen/video evidence from signup through first useful result.
- [ ] **MANUAL — Verify staging and production endpoint configurations independently.** Account linking must pass when production URLs are copied into staging, as required before certification.
- [ ] **MANUAL — Verify relinking after deliberate Ring revocation.** Confirm stale credentials stop working, the UI explains the cause, and reconnection restores only authorized devices.
- [ ] **MANUAL — Verify device removal while its detail or live view is open.** The stream must close, cached data must be retired as required, and the user must return to a safe screen with a clear explanation.
- [ ] **MANUAL — Verify expired access and refresh tokens.** Routine access-token refresh should be silent; a truly expired or revoked refresh token should produce a clear relink action.
- [ ] **MANUAL — Test setup with at least three non-developer users.** Record completion time, abandon points, confusing copy, and support questions.

### Codex — software work

- [x] **CODEX — SOFTWARE — Provide separate SpatialGuard account signup/sign-in and skippable first-run onboarding.**
- [x] **CODEX — SOFTWARE — Explain that Ring credentials are entered only in Ring's flow.**
- [x] **CODEX — SOFTWARE — Show a successful Ring-link confirmation and authorized inventory.**
- [ ] **CODEX — SOFTWARE — Replace copied sign-in codes with a secure signed-in continuation.** Bind the Ring return to the existing owner session, protect it from CSRF, show the account being linked, and retain a safe fallback for cross-device linking.
- [ ] **CODEX — SOFTWARE — Add email verification and password reset.** Use short-lived, single-use tokens; hashed token storage; rate limits; neutral responses that do not reveal whether an email exists; and transactional-email delivery. This was intentionally deferred from the previous milestone but is required before a serious public launch.
- [ ] **CODEX — SOFTWARE — Add account recovery and session-security UX.** Include password change, “sign out all devices,” recent security activity, session names, and notification of sensitive account changes.
- [ ] **CODEX — SOFTWARE — Add abuse-resistant authentication controls.** Rate-limit signup/login/reset/link attempts, detect credential stuffing, rotate sessions after authentication, and add CSRF protection to browser mutations.
- [ ] **CODEX — SOFTWARE — Prefill the signup email from the Ring Users API when permitted.** Keep deferred verification only if the documented Ring pattern applies; otherwise use the verified-email flow.
- [ ] **CODEX — SOFTWARE — Refresh inventory automatically after returning from Ring.** Continue directly into device selection and map placement.
- [ ] **CODEX — SOFTWARE — Add device-compatibility checks before setup continues.** Explain unsupported devices and required Ring subscriptions early.
- [ ] **CODEX — SOFTWARE — Add Ring-app configuration guidance.** For missing motion events, motion recording, Smart Alerts, motion zones, and privacy zones, explain what is wrong, why it matters, and the exact place to fix it in the Ring app.

### Codex — document work

- [ ] **CODEX — DOCUMENT — Write a reviewer-ready account creation and linking procedure.** It must work without private developer knowledge and fit the Ring certification notes field.
- [ ] **CODEX — DOCUMENT — Write a customer setup guide and troubleshooting guide.** Cover subscriptions, device compatibility, Smart Alerts, motion zones, offline devices, relinking, and deletion.

## A3. Ring API correctness and real-device lifecycle

### Manual verification

- [ ] **MANUAL — Trigger and capture a real signed `motion_detected` webhook end to end.** Record provider request ID, receipt time, signature result, durable acceptance, incident creation, and UI update. This is the largest remaining integration proof gap.
- [ ] **MANUAL — Trigger and capture a real `button_press` event if the connected model supports it.**
- [ ] **MANUAL — Trigger real `device_online` and `device_offline` transitions.** Verify the current status display without relying on the potentially prohibited uptime-monitor feature.
- [ ] **MANUAL — Verify `device_added`, `device_removed`, `app_integration_removed`, `subscription_activated`, and `subscription_deactivated` behavior using staging or physical devices where available.**
- [ ] **MANUAL — Verify live session limits on one battery device and one line-powered device.** Confirm the provider timeout, visible countdown/state, explicit close, and cleanup after browser close, backgrounding, network loss, and server restart.
- [ ] **MANUAL — Verify two-camera concurrency and the practical camera-wall limit.** Do not claim 16 simultaneous live streams unless Ring, the account, network, browser, and tested devices support it.
- [ ] **MANUAL — Confirm all Ring-provided media watermarks remain visible and unmodified.** Test snapshots, live video, and any future clips.
- [ ] **MANUAL — Test daylight, night, backlight, offline, slow network, and unavailable-media cases.** Record actual outcomes rather than estimated accuracy.
- [ ] **MANUAL — Run a 24-hour staging soak test.** Monitor token refresh, webhook delivery, worker recovery, memory, database growth, stuck sessions, and user-visible stale states.

### Codex — software work

- [x] **CODEX — SOFTWARE — Verify webhook HMAC signatures over the raw request body and deduplicate provider events.**
- [x] **CODEX — SOFTWARE — Keep provider sessions bounded and support explicit close.**
- [x] **CODEX — SOFTWARE — Isolate Ring-specific behavior behind the provider adapter.**
- [ ] **CODEX — SOFTWARE — Add a provider event delivery dashboard.** Show sanitized event type, request ID, received/processed state, retry count, and failure reason for owners/admins.
- [ ] **CODEX — SOFTWARE — Add complete webhook lifecycle handling.** Cover all configured events, out-of-order delivery, duplicates, deletion/revocation, subscription loss, poison messages, and bounded retries.
- [ ] **CODEX — SOFTWARE — Fetch and enforce Ring privacy zones before displaying, analyzing, or storing frames.** Exclude masked regions without exposing zone coordinates in customer-facing UI.
- [ ] **CODEX — SOFTWARE — Integrate the Subscriptions Query API.** Display applicable Ring plan/trial state and handle loss of eligibility. If SpatialGuard is paid later, direct purchase/cancellation management to Ring My Apps.
- [ ] **CODEX — SOFTWARE — Make capability discovery authoritative.** Only render live view, snapshots, clips, event history, or other actions when the selected device/account supports them.
- [ ] **CODEX — SOFTWARE — Reconcile camera-wall behavior with documented session limits.** Add a queue or explicit tile activation instead of uncontrolled renewal and show stale/closed states honestly.
- [ ] **CODEX — SOFTWARE — Add watermark-aware image-processing tests.** Ensure the Ring watermark does not cause false classifications and is never cropped or obscured.
- [ ] **CODEX — SOFTWARE — Add production observability.** Structured redacted logs, request correlation, health checks, queue age, webhook latency, failure-rate alerts, and provider-session leak detection.

## A4. Privacy, deletion, security, and operations

### Manual and external verification

- [ ] **MANUAL — Verify the published privacy policy against the actual deployed data flow.** Every data type and third party must match production behavior.
- [ ] **MANUAL — Perform a full deletion drill.** Delete an account with a linked Ring account, maps, incidents, time-lapse media, sessions, and classifications; confirm downstream deletion and user confirmation.
- [ ] **MANUAL — Define how Railway backups and archived copies satisfy deletion requests.** Current logical deletion does not establish deletion from infrastructure backups.
- [ ] **MANUAL — Rotate every credential that was copied into chat, local terminals, screenshots, or old deployment variables.** Confirm old credentials no longer work.
- [ ] **MANUAL — Configure a monitored support address, abuse-report channel, security contact, and incident-response owner.** Test that messages receive a response.
- [ ] **EXTERNAL REVIEW — Review OpenAI, Railway, email-provider, and analytics contracts/data terms.** Record subprocessors, locations, retention, breach notification, and deletion commitments.
- [ ] **EXTERNAL REVIEW — Complete a threat model and penetration test after the production architecture is frozen.** Retest all high/critical findings.

### Codex — software work

- [x] **CODEX — SOFTWARE — Provide separate Ring-data and snapshot-classification consent controls.**
- [x] **CODEX — SOFTWARE — Provide in-app account deletion and configurable incident/audit retention.**
- [x] **CODEX — SOFTWARE — Keep Ring credentials server-side and encrypted at rest.**
- [ ] **CODEX — SOFTWARE — Move production persistence from single-instance SQLite files to managed PostgreSQL and private object storage.** Add migrations, backups, restore testing, per-owner authorization, and deletion jobs. Retain SQLite only for local development.
- [ ] **CODEX — SOFTWARE — Implement backup-aware deletion.** Define a documented maximum backup-retention window, prevent deleted data from returning during restore, and propagate deletion to every processor and archive.
- [ ] **CODEX — SOFTWARE — Add a user-visible deletion receipt.** Record request time, completion time, categories removed, downstream completion, and a non-sensitive audit reference.
- [ ] **CODEX — SOFTWARE — Add export/access-request support.** Let an owner retrieve the data associated with the account in a documented machine-readable form.
- [ ] **CODEX — SOFTWARE — Add notification preferences with granular channel and frequency controls.** Include operational, incident, summary, and marketing categories; default marketing off.
- [ ] **CODEX — SOFTWARE — Add security headers and production browser protections.** Verify CSP, HSTS, frame restrictions, MIME sniffing protection, referrer policy, secure cookies, CORS/origin rules, and dependency integrity.
- [ ] **CODEX — SOFTWARE — Automate dependency, secret, license, and static security scanning in CI.** Fail releases for committed secrets and unreviewed critical vulnerabilities.
- [ ] **CODEX — SOFTWARE — Add tenant-isolation and authorization fuzz tests.** Include cross-owner object IDs, media URLs, sessions, event streams, deleted accounts, and replay/live boundaries.
- [ ] **CODEX — SOFTWARE — Remove sensitive data from logs and error responses.** Add tests for tokens, authorization codes, email addresses, device IDs, snapshots, floor plans, and Ring payloads.
- [ ] **CODEX — SOFTWARE — Add documented incident-response controls.** Credential revocation, forced session logout, provider disconnect, maintenance mode, audit preservation, and user notification hooks.

### Codex — documents

- [ ] **CODEX — DOCUMENT — Replace preview legal pages with final, versioned policies approved by the owner and counsel.** Include effective date, controller/contact, data categories, purposes, legal basis where applicable, subprocessors, transfers, retention, deletion, consent withdrawal, user rights, complaint path, children, and change notice.
- [ ] **CODEX — DOCUMENT — Create a security overview.** Cover authentication, encryption, secret management, tenant isolation, webhook verification, least privilege, monitoring, backups, vulnerability management, and incident response.
- [ ] **CODEX — DOCUMENT — Create retention and deletion operating procedures.** Include downstream services and backup expiry.
- [ ] **CODEX — DOCUMENT — Create an abuse-report and security-report page.** Include expected response windows without promising unsupported guarantees.
- [ ] **CODEX — DOCUMENT — Maintain a subprocessor list and change-notification process.**

## A5. Product experience and accessibility

### Manual verification

- [ ] **MANUAL — Complete a WCAG 2.2 AA audit on desktop and mobile.** Test keyboard-only navigation, screen readers, focus order, 200%/400% zoom, contrast, reduced motion, captions, and error announcements.
- [ ] **MANUAL — Test the web app on current Chrome, Edge, Safari, and Firefox, plus Android Chrome and the packaged Android app.**
- [ ] **MANUAL — Test the Android release on a physical device.** Cover install, first launch, rotation, back navigation, background/resume, offline recovery, camera permission behavior if any, external links, and low-memory restart.
- [ ] **MANUAL — Conduct five task-based usability sessions.** Measure whether users can link Ring, choose a camera, understand an incident, explain an unknown gap, review/delete data, and recover from an offline camera without coaching.
- [ ] **MANUAL — Verify every empty, loading, stale, offline, denied, revoked, expired, and server-error state.** No blank panels or generic internal errors.

### Codex — software and design work

- [x] **CODEX — SOFTWARE — Provide responsive navigation, camera views, incident review, 2D/3D views, and an evidence graph.**
- [x] **CODEX — SOFTWARE — Keep camera observations and uncertain continuations visually distinct.**
- [ ] **CODEX — SOFTWARE — Complete keyboard and screen-reader semantics for the map, camera wall, incident timeline, dialogs, and 3D controls.** Provide an equivalent text evidence timeline for spatial visuals.
- [ ] **CODEX — SOFTWARE — Add reduced-motion and low-power modes.** Keep the core incident-review experience useful without WebGL or animation.
- [ ] **CODEX — SOFTWARE — Add polished recovery states.** Every recoverable failure needs a plain-language cause, its effect, and the next action.
- [ ] **CODEX — SOFTWARE — Add notification history and status.** Users should see what was sent, suppressed, delayed, or failed.
- [ ] **CODEX — SOFTWARE — Remove developer and hackathon terminology from the production customer flow.** Retain it only in reviewer/demo mode.
- [ ] **CODEX — SOFTWARE — Run visual regression tests across supported breakpoints.** Cover onboarding, home, incidents, cameras, settings, legal pages, camera wall, 2D, and 3D.

## A6. Public listing, certification, and rollout

### Manual and portal work

- [ ] **MANUAL — Complete Amazon/Ring developer identity verification.**
- [ ] **MANUAL — Configure the Public App with least-privilege scopes and separate staging/production HTTPS endpoints.**
- [ ] **MANUAL — Keep the production endpoints stable throughout review.** Monitor logs and respond promptly to reviewer traffic/questions.
- [ ] **MANUAL — Complete all five Privacy & Legal Questionnaire tabs.** General, Data processing, AI governance, Data protection, and Third parties must match the deployed build.
- [ ] **MANUAL — Paste and verify reviewer notes for account creation, Ring account linking, and the end-to-end test scenario.** Each portal field allows 20–4000 characters.
- [ ] **MANUAL — Submit only after testing account linking with both staging and production endpoint configurations.**
- [ ] **MANUAL — Start with an invite-only beta, then use a controlled rollout after telemetry and support results are acceptable.**
- [ ] **MANUAL — Define a recertification trigger.** Privacy-policy changes, new data uses, AI changes, third-party changes, and material feature changes may require review again.

### Codex — documents and assets

- [ ] **CODEX — DOCUMENT/ASSET — Create the final Ring Appstore listing package:**
  - [ ] Public name: 7–30 characters and distinct from Ring/Amazon trademarks.
  - [ ] 1024×1024 PNG/JPEG icon under 2 MB that works on light and dark backgrounds.
  - [ ] Short description up to 125 characters.
  - [ ] Detailed description up to 500 characters.
  - [ ] Category selection and latest-release notes up to 300 characters.
  - [ ] Main image plus 1–5 accurate product images, recommended 1024×1024 and under 2 MB each.
  - [ ] Optional MP4 up to 30 seconds, at least 720p and under 5 MB, plus thumbnail.
  - [ ] Features up to 400 characters and requirements up to 500 characters.
  - [ ] Supported customer/device/camera compatibility selections.
  - [ ] Developer information, website, support, privacy, and terms URLs.
- [ ] **CODEX — DOCUMENT — Draft the three certification reviewer-note answers and an end-to-end expected-results table.**
- [ ] **CODEX — DOCUMENT — Create an Appstore setup walkthrough and support knowledge base.**
- [ ] **CODEX — DOCUMENT — Prepare release notes, rollback instructions, and a post-release monitoring checklist.**
- [ ] **CODEX — DOCUMENT — Review all Ring brand usage against current Ring Appstore Marketing Guidelines.** Send any press release or integration-focused marketing video for Ring PR approval 10–12 business days before publication when the guidelines require it.

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

- [ ] **MANUAL — Confirm every entrant is eligible.** Check age of majority, residence/location restrictions, employer/sponsor conflicts, and team authorization in the official rules.
- [ ] **MANUAL — Join the hackathon on Devpost and choose the Ring primary track.**
- [ ] **MANUAL — Select mini challenges only when the project qualifies.** The current Railway deployment does not qualify for the AWS Builder mini challenge by itself. The Open Source mini challenge requires a new additional public project or a meaningful contribution made during the event, with its own contribution URL and required explanation.
- [ ] **MANUAL — Decide whether the repository will be public or private for judging.**
  - [ ] If public, keep an OSI-style license visible and remove all private data/secrets.
  - [ ] If private, invite `testing@devpost.com` and the Amazon GitHub reviewers named in the rules: `chris-trag`, `knmeiss`, `giolaq`, `anishamalde`, `mosesroth`, and `emersonsklar`.
- [ ] **MANUAL — Keep the hosted app free and available to judges through the end of judging.** Set a Railway budget alert and monitor uptime without exposing private camera access.
- [ ] **MANUAL — Put fresh judge credentials and exact testing instructions in the private submission field.** Do not commit the password or publish it in screenshots/video.
- [ ] **MANUAL — Record a public YouTube or Vimeo demonstration shorter than three minutes.** Show the intended platform and an actual Ring device or official simulator working.
- [ ] **MANUAL — Verify the demo contains no private home details, tokens, email addresses, license plates, faces without consent, copyrighted music, or unapproved third-party assets/trademarks.**
- [ ] **MANUAL — Complete every Devpost field in English.** Include the text description, repository URL, public video URL, primary track, tools/APIs used, product feedback, and testing instructions.
- [ ] **MANUAL — Submit before the deadline and independently reopen every URL from a signed-out browser.** Save a submission receipt and screenshots.

### Codex — software and repository work

- [x] **CODEX — SOFTWARE — The running project calls Ring account-linking, inventory, snapshot, and WHEP APIs at runtime rather than merely naming Ring in documentation.**
- [x] **CODEX — SOFTWARE — The repository contains source code, a license, setup instructions, verification notes, and a hosted deployment path.**
- [ ] **CODEX — SOFTWARE — Add a one-command judge demo seed/reset.** It must preserve the test account, use sanitized synthetic content, and never connect judges to the owner's real Ring camera.
- [ ] **CODEX — SOFTWARE — Add a read-only demo mode if Ring staging access is unavailable.** Label it Replay and keep the live-integration proof separate.
- [ ] **CODEX — SOFTWARE — Add a public `/status` or reviewer diagnostics page.** Show sanitized service health, deployment version, enabled evidence mode, and dependency availability without secrets.
- [ ] **CODEX — SOFTWARE — Run a clean clone/install/build/test on a machine or container without developer state.** Record exact versions, duration, and failures fixed.
- [ ] **CODEX — SOFTWARE — Add CI for backend tests, frontend type/build/browser tests, Android build, contract generation drift, secret scan, and license checks.**
- [ ] **CODEX — SOFTWARE — Remove all private files and generated artifacts from Git history, not only the current working tree.** Verify with secret/history scanning before granting judges access.

### Codex — documents and assets

- [ ] **CODEX — DOCUMENT — Create `JUDGES.md`.** Include a five-minute test path, credentials location, expected results, replay/live labels, limitations, troubleshooting, and support contact.
- [ ] **CODEX — DOCUMENT — Create a submission-period change log.** Clearly distinguish the pre-August-31 baseline from substantial work completed during the hackathon window.
- [ ] **CODEX — DOCUMENT — Produce a software bill of materials and third-party attribution list.** Confirm licenses for icons, 3D assets, fonts, screenshots, test video, OpenCV/model weights, and generated imagery.
- [ ] **CODEX — DOCUMENT — Draft the Devpost description and product-feedback answers.** Explain what Ring tools were used, what worked, what needs improvement, onboarding experience, and whether the team would build with them again.
- [x] **CODEX — DOCUMENT — Maintain a Ring developer friction log with task, steps, expected/actual behavior, severity, workaround, and actionable suggestion.**
- [ ] **CODEX — DOCUMENT — Edit the friction log for submission.** Remove sensitive details, add evidence dates, prioritize the strongest entries, and ensure each claim is reproducible.

## B2. Tech Implementation — 10/10 target

### Manual verification

- [ ] **MANUAL — Capture the real signed motion-event proof.** A real physical trigger should reach the hosted webhook, create a durable camera observation/incident, and update the UI.
- [ ] **MANUAL — Demonstrate at least two camera sources.** Best: two physical Ring cameras. Acceptable fallback: one real Ring camera plus the official Ring simulator, with each source labeled accurately. A synthetic SpatialGuard replay is useful evidence but does not prove a second Ring integration.
- [ ] **MANUAL — Perform the complete demo twice without intervention.** Measure event-to-UI latency and confirm no duplicate incidents.
- [ ] **MANUAL — Demonstrate one honest failure path.** For example, revoke access or take a camera offline and show the gap/recovery state.

### Codex — software work

- [ ] **CODEX — SOFTWARE — Turn the live Ring event into the same explainable evidence model used by replay.** Persist provenance, event time, source camera, revision, evidence mode, and unknown location.
- [ ] **CODEX — SOFTWARE — Add measurable pipeline telemetry.** Report webhook acknowledgment latency, queue latency, incident creation latency, duplicate suppression, error rate, and recovery time.
- [ ] **CODEX — SOFTWARE — Add deterministic failure and recovery tests.** Cover provider throttling, delayed/out-of-order events, duplicate delivery, Ring/TwinForge outage, worker restart, revocation, and stale camera status.
- [ ] **CODEX — SOFTWARE — Pin and document every production dependency/model version.** Make the demo reproducible.
- [ ] **CODEX — SOFTWARE — Keep TwinForge and SpatialGuard boundaries enforceable in tests.** SpatialGuard must consume the public API/SDK and never read TwinForge's database.

## B3. Design — 10/10 target

### Manual verification

- [ ] **MANUAL — Run five usability sessions on the three-minute story.** A participant should answer: what happened, which camera observed it, what is only possible, and what is unknown.
- [ ] **MANUAL — Test the exact demo on the recording computer, a phone, and a physical Android device.**
- [ ] **MANUAL — Review every screen at presentation zoom and in poor network conditions.** Fix cropped content, unreadable labels, layout jumps, and dead controls.

### Codex — software/design work

- [ ] **CODEX — SOFTWARE — Make the Spatial Evidence Graph the visual center of the product.** Camera wall, time-lapse, and uptime status should support the story rather than dilute it.
- [ ] **CODEX — SOFTWARE — Add a concise evidence inspector.** Selecting a node should show timestamp, camera name, evidence mode, associated media availability, triggering rule, certainty language, and revision.
- [ ] **CODEX — SOFTWARE — Make unknown gaps understandable without reading documentation.** Use consistent legend, line treatment, hover/focus explanation, and text equivalent.
- [ ] **CODEX — SOFTWARE — Complete a visual polish pass.** Harmonize spacing, typography, controls, loading skeletons, motion, chart/map density, and empty/error states across web and Android.
- [ ] **CODEX — SOFTWARE — Meet WCAG 2.2 AA for the judged workflow.** Include keyboard and screen-reader alternatives for map/3D information.

## B4. Potential Impact — 10/10 target

### Manual research

- [ ] **MANUAL — Interview at least five multi-camera Ring owners.** Record their current review workflow, time spent, mistakes, trust concerns, and willingness to try SpatialGuard.
- [ ] **MANUAL — Run a timed comparison.** Give participants the same event using a camera-by-camera baseline and SpatialGuard; measure time to reconstruct, errors, and confidence without leading them.
- [ ] **MANUAL — Obtain two concise user quotes with permission for the submission.** Do not fabricate testimonials.
- [ ] **MANUAL — Define the first realistic customer segment and price hypothesis.** Keep the initial claim narrow, such as owners with several cameras reviewing one property.

### Codex — documents and analysis

- [ ] **CODEX — DOCUMENT — Create a competitor/problem comparison.** Focus on separate-camera review versus spatial evidence and uncertainty; avoid unsupported claims that Ring lacks capabilities.
- [ ] **CODEX — DOCUMENT — Summarize user-study results with sample size and limitations.** Do not present a tiny study as market validation.
- [ ] **CODEX — DOCUMENT — Create a credible deployment/cost model.** Estimate per-owner storage, event volume, inference cost, streaming load, support burden, and Railway/AWS scale path.
- [ ] **CODEX — DOCUMENT — Define success metrics.** Setup completion, linked-device success, webhook delivery, incident review time, false-label correction, retention/deletion completion, and support rate.

## B5. Quality of the Idea — 10/10 target

### Manual positioning decisions

- [ ] **MANUAL — Commit to one flagship message:** “SpatialGuard organizes authorized multi-camera events into a reviewable spatial evidence graph while preserving what the cameras did not establish.”
- [ ] **MANUAL — Keep the primary demo on the creative Ring criteria.** Show a multi-camera pipeline and event-based behavior, not merely a motion alert or live-view grid.
- [ ] **MANUAL — Decide which secondary features to omit from the three-minute submission.** Camera wall, uptime, and time-lapse can make the product feel unfocused when they do not support the flagship story.

### Codex — software and documents

- [ ] **CODEX — SOFTWARE — Provide a polished before/after comparison mode.** Show the old camera-by-camera evidence list beside the SpatialGuard evidence graph using the same event.
- [ ] **CODEX — SOFTWARE — Make uncertainty a useful interaction.** Let the reviewer inspect why a continuation is possible, which time/adjacency facts support it, and which missing evidence prevents a stronger claim.
- [ ] **CODEX — DOCUMENT — Explain why TwinForge is reusable infrastructure rather than a decorative 3D model.** Connect immutable revisions, camera placement, spatial queries, and provenance directly to incident trust.
- [ ] **CODEX — DOCUMENT — State the ethical boundary as a product advantage.** No face recognition, cross-account identity, continuous route invention, gender inference, automatic accusation, or emergency dispatch.

## B6. Demo and submission package

### Manual recording and submission

- [ ] **MANUAL — Record the final video only after the exact hosted build is frozen.**
- [ ] **MANUAL — Keep the video under 2:50 to leave margin below the three-minute limit.** Judges are not required to watch past three minutes.
- [ ] **MANUAL — Add captions and verify readability on a phone.**
- [ ] **MANUAL — Show the physical Ring trigger or official simulator, hosted UI update, evidence graph, evidence inspection, unknown gap, review action, and one failure/revocation state.**
- [ ] **MANUAL — Upload publicly to YouTube or Vimeo and test playback signed out.**
- [ ] **MANUAL — Submit at least 24 hours early.** Recheck repo access, judge login, hosted URL, video, screenshots, and every required field.

### Codex — documents and assets

- [ ] **CODEX — DOCUMENT — Write the final 2:45 narration and shot list.**
- [ ] **CODEX — DOCUMENT/ASSET — Capture final screenshots:** landing page, onboarding, live camera/device status, spatial evidence graph, incident detail, unknown gap, privacy controls, and phone layout.
- [ ] **CODEX — DOCUMENT — Draft the final Devpost copy around the four equal criteria.** Lead with the customer problem and live Ring proof.
- [ ] **CODEX — DOCUMENT — Prepare a concise limitations section.** Separate physical-device results, official simulator results, synthetic replay, and unverified behavior.
- [ ] **CODEX — DOCUMENT — Prepare a submission-day verification record with timestamped URLs, commit SHA, deployed version, test results, and backup contact.**

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
- [ ] **2. Finish production identity:** email verification, password reset, secure linking continuation, account recovery, and abuse controls.
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

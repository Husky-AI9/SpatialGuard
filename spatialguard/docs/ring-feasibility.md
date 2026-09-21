# Ring feasibility — local preview

Status as of September 19, 2026: a US Ring account with an active plan is allowlisted for the private app. The Ring Appstore completed the one-way OAuth exchange and account-link nonce flow. SpatialGuard securely stored the tokens, Ring reports the integration as **Active**, and the authorized **Front Door** Video Doorbell (2nd Gen) was discovered online and mapped to the demo home's `camera_front` placement.

| Gate | Current evidence | Remaining verification |
|---|---|---|
| G1 Developer access | Private app, scopes, credentials, and four HTTPS callback URLs configured | Replace the changing quick-tunnel URL with stable hosted HTTPS before routine use |
| G2 Account linking | Real authorization-code exchange, nonce claim, POST/PATCH app-integration completion, and authorized inventory succeeded | Verify relink after deliberate revocation |
| G3 Events/video | Signed webhook ingestion and bounded WHEP code have automated coverage | Observe one real motion or doorbell event and one real video-only live-view session |
| G4 Lifecycle | Token rotation, idempotency, stream cleanup, pause, mapping, and local revocation have tests | Verify provider-side device removal, token expiry refresh, and stream timeout against Ring |
| G5 Data use | Only selected device metadata is stored; credentials are DPAPI encrypted; no live frames are retained | Review current Ring terms before adding frame inference or retention |
| G6 Delegated viewing | Disabled | Keep caregiver video disabled until official authorization and cutoff behavior are proven |

Official references: [developer portal](https://developer.ring.com/), [configuration](https://developer.amazon.com/docs/ring/configure.html), [development](https://developer.amazon.com/docs/ring/develop.html), and [certification](https://developer.amazon.com/docs/ring/certify.html).

Replay remains labeled **Replay**. Account linking and authorized inventory are **Live integration** evidence; they are not proof that event delivery, video transport, spatial accuracy, or Ring certification has passed.

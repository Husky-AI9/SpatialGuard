# Hosted Ring linking verification

Date: September 21, 2026

Verified against the Railway deployment with an authorized physical Ring camera.
No account identifiers, credentials, sign-in codes, images, or video are included.

## Observed results

- Ring's pending integration offered Sign in, which generated a fresh linking URL.
- A code generated in the authenticated hosted workspace was submitted through
  the real browser HTML form. The page displayed "Ring account connected".
- The hosted workspace displayed "Account connected · Live integration".
- Refresh Ring cameras returned the authorized physical camera.
- The camera was assigned to the front-camera marker in the synthetic demo map.
  This assignment does not validate the map against the real property.
- Open live view displayed visible nighttime camera footage via the hosted app.
  The UI identified it as live, video only, and not recorded.
- Close live view returned to Home; a real camera snapshot was visible in its tile.
- Ring's own connected-apps page independently displayed the integration as Active.
- Automated Ring tests: 22 passed. TypeScript checking and the production web
  build passed; Vite retained its existing large-chunk advisory.

## Root cause and fix

The linking page's no-referrer policy suppressed the Origin on native browser
form POSTs, producing Origin: null. This triggered the application's origin
guard before code validation. Earlier host-rewriting fixes did not address it.

The Ring gateway now returns Referrer-Policy: strict-origin, and the parent API
preserves that policy instead of overwriting it. Only the origin is sent as the
referrer; the nonce-bearing query string is not. Hosted form validation compares
the exact configured HTTPS origin. Null, foreign, wrong-scheme, and cross-site
submissions remain rejected. Signed nonce, expiry, owner code, and single-use
checks remain in place.

## Tester experience and remaining release work

The hosted setup is usable for invited private-app testers with an authenticated
SpatialGuard workspace. Developer callback URLs are collapsed; customer-facing
guidance opens the Ring Appstore and links back to the hosted workspace.

Before public release:

- Rename and brand the private Ring listing, currently named test.
- Add verified email and a password-reset flow to the new individual account system.
- Replace code copying with a secure continuation for an already signed-in owner,
  with explicit account confirmation and a CSRF-protected claim.
- Refresh inventory after returning from Ring and guide camera placement directly.
- Verify an independent new-user run; this test used an already authenticated owner.
- Complete Ring public-app approval before offering unrestricted discovery.

This check verifies linking, inventory, snapshot, and live-view playback on one
camera. It does not verify real motion/doorbell webhook delivery, classification,
person location accuracy, public signup, or every camera/device model.

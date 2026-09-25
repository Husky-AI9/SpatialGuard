# Test SpatialGuard on iOS

The iOS app uses the same React interface, colors, maps, and camera screens as Android. It packages those shared screens inside Capacitor and connects to the hosted Railway service at `https://spatialguard-production.up.railway.app`. Sign-in tokens are stored in the iOS Keychain.

## Requirements

- A Mac running a recent macOS version supported by Xcode 16 or newer.
- Xcode with an iOS Simulator runtime installed. For a physical iPhone, sign in to Xcode with an Apple ID and select a development team for local signing.
- Node.js and npm.

This repository can prepare and sync the iOS project on Windows, but Xcode can only build and run it on macOS.

## Run in the iOS Simulator

1. Clone or pull the repository on the Mac.
2. In Terminal, change to the repository root and run:

   ```sh
   npm ci
   npm run build --workspace spatialguard-web
   npm run ios:sync --workspace spatialguard-web
   npm run ios:open --workspace spatialguard-web
   ```

3. In Xcode, select the **App** scheme and an iPhone simulator, then click **Run**.
4. On the SpatialGuard landing page, choose **Sign in** and use an account on the hosted service. The iOS build is already configured to use Railway; it does not need a local server, `127.0.0.1`, an access token, or a local environment file.
5. Try Home in 2D and 3D, camera selection and live view, Incidents, Cameras, and Settings. Camera access depends on the Ring account and provider connection being available to that hosted SpatialGuard account.

## Run on a physical iPhone

1. Connect the iPhone to the Mac and trust it when prompted.
2. Open the project in Xcode using the commands above. In **Signing & Capabilities**, select your Apple development team for the **App** target. Keep the bundle identifier `app.spatialguard.mobile` for local preview unless it conflicts with an app already installed under your Apple team.
3. Select the iPhone as the run destination and click **Run**. If prompted, enable Developer Mode on the iPhone and trust the development certificate.
4. Sign in to the hosted account and try the same screens. The phone needs an internet connection to reach Railway and Ring.

## Refresh after code changes

Run the build, then `npm run ios:sync --workspace spatialguard-web` again before opening Xcode. This copies the latest shared web interface into the iOS app. Native iOS code changes require another Xcode build.

The iOS binary and simulator build cannot be produced or verified from Windows because Apple requires macOS and Xcode. The project, shared app assets, hosted endpoint, and test steps are prepared here for the Mac build.

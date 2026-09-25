# SpatialGuard Expo Go preview

This small Expo client opens the hosted SpatialGuard application at
`https://spatialguard-production.up.railway.app/landing`. It keeps the mobile
landing page, authentication, map, incidents, cameras, operations, and
settings experience identical to the current Android/web interface while it
is being tested in Expo Go.

## Run on an iPhone from Windows

Install Node.js, then run:

```bash
cd spatialguard/apps/expo-go
npx expo install
npx expo start
```

Install **Expo Go** from the App Store, scan the QR code shown by Expo, and
open the project. The phone and Windows computer must be on the same network.

This preview uses the hosted Railway endpoint. It does not use the local API
or ADB reverse. Keep the Expo Go app open while testing; a production iOS
build will later use a signed native workflow and App Store/TestFlight
distribution.

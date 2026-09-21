# Railway hosted preview

The root `Dockerfile` runs the web bundle, SpatialGuard API and worker, and a
private TwinForge API and worker in one Railway service. SpatialGuard reaches
TwinForge through its public HTTP/SDK boundary; it never opens TwinForge''s
database. This keeps the hosted demo easy to run while preserving the service
boundary needed for a later split deployment.

## Configure the Railway service

1. Deploy the GitHub repository using its root `Dockerfile` and create a
   Railway domain.
2. Add a Railway Volume mounted at `/data` before connecting any Ring account.
3. Set these variables, substituting the generated Railway domain:

```text
SPATIALGUARD_ALLOWED_HOSTS=spatialguard-production.up.railway.app
SPATIALGUARD_ORIGIN=https://spatialguard-production.up.railway.app
SPATIALGUARD_DATA_DIR=/data
SPATIALGUARD_DB=/data/spatialguard.sqlite3
TWINFORGE_DB=/data/twinforge.sqlite3
SPATIALGUARD_HOSTED_ACCESS_CODE=<a unique 12+ character code>
SPATIALGUARD_TOKEN_KEY=<a Fernet key>
```

Generate the token-encryption key locally, then put its output only in Railway
Variables:

```powershell
./.venv/Scripts/python.exe -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

The access code protects the single-owner demo session. It is not a substitute
for production accounts, password recovery, or delegated access. The browser
stores only a Secure, HttpOnly, SameSite cookie; Android receives a separate,
revocable pairing credential.

## Ring configuration

Set these Railway Variables from the private Ring app portal. They replace the
local ignored CSV and never reach the browser or Android build:

```text
RING_CLIENT_ID=
RING_CLIENT_SECRET=
RING_WEBHOOK_SECRET=
```

After a successful deploy, enter these HTTPS endpoints in the private Ring app:

```text
https://spatialguard-production.up.railway.app/ring/link
https://spatialguard-production.up.railway.app/ring/home
https://spatialguard-production.up.railway.app/ring/token
https://spatialguard-production.up.railway.app/ring/webhook
```

Open SpatialGuard, sign in with the hosted access code, then use **Settings ?
Ring connection** to create a Ring sign-in code and finish the private-app
authorization. Ring OAuth tokens are encrypted with `SPATIALGUARD_TOKEN_KEY`
before they are written to the mounted SQLite database.

## Android release preview

Build the release only after the Railway URL works in a browser:

```powershell
$env:SPATIALGUARD_API_URL = "https://spatialguard-production.up.railway.app"
./spatialguard/scripts/android.ps1 -Release
```

Sign in to the hosted web workspace, create an Android pairing code in
**Settings**, then enter it in the release app. The code is single-use and
expires in three minutes.

## Current deployment boundary

This is a durable hosted preview when the `/data` volume is attached. It uses
one owner access code, one service replica, and SQLite WAL on that volume. It
does not yet provide PostgreSQL, multi-user login, backups, object storage,
hosted push notifications, or a high-availability worker. Those are required
before treating it as a production security service.

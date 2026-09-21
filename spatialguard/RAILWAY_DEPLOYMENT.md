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
SPATIALGUARD_TOKEN_KEY=<a Fernet key>
```

Generate the token-encryption key locally, then put its output only in Railway
Variables:

```powershell
./.venv/Scripts/python.exe -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

SpatialGuard stores salted scrypt password verifiers and gives each account an
isolated owner ID. The browser stores only a Secure, HttpOnly, SameSite cookie;
Android receives a separate revocable bearer session after email/password sign
in. Railway deployments create the isolated hackathon test account documented
on the sign-in page by default. Set `SPATIALGUARD_ENABLE_TEST_ACCOUNT=false` to
disable it. The test account does not have access to another owner's site or
Ring connection.

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

Open SpatialGuard, create an account or sign in, then use **Settings →
Ring connection** to create a Ring sign-in code and finish the private-app
authorization. Ring OAuth tokens are encrypted with `SPATIALGUARD_TOKEN_KEY`
before they are written to the mounted SQLite database.

## Android release preview

Build the release only after the Railway URL works in a browser:

```powershell
$env:SPATIALGUARD_API_URL = "https://spatialguard-production.up.railway.app"
./spatialguard/scripts/android.ps1 -Release
```

Sign in from Android with the same email and password as the hosted web app.
The optional device-pairing flow in **Settings** remains available for local
development and its codes are single-use and expire in three minutes.

## Current deployment boundary

This is a durable hosted preview when the `/data` volume is attached. It uses
individual email accounts, one service replica, and SQLite WAL on that volume.
It does not yet provide verified email, password reset, PostgreSQL, backups,
object storage, hosted push notifications, or a high-availability worker.
Those are required before treating it as a production security service.

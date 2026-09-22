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
SPATIALGUARD_RELEASE_PROFILE=certification
```

Generate the token-encryption key locally, then put its output only in Railway
Variables:

```powershell
./.venv/Scripts/python.exe -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

SpatialGuard stores salted scrypt password verifiers and gives each account an
isolated owner ID. The browser stores only a Secure, HttpOnly, SameSite cookie;
Android receives a separate revocable bearer session after email/password sign
in. Railway creates the isolated reviewer account only when both
`SPATIALGUARD_REVIEWER_EMAIL` and `SPATIALGUARD_REVIEWER_PASSWORD` are present.
Keep both in Railway Variables and private reviewer instructions; never commit
or show them in the app. `SPATIALGUARD_DEMO_READ_ONLY=true` protects the demo
from ordinary reviewer writes. The reset script additionally requires the
operator-only `SPATIALGUARD_REVIEWER_KEY`. The reviewer account does not inherit
another owner's site or Ring connection.

To use that private account with a real test camera, sign in with its credentials,
seed its demo place with `spatialguard/scripts/judge-demo.py`, then complete the
normal **Settings → Ring connection** flow while signed into the intended Ring
account. Map only the dedicated camera used for review. Ring authorization is an
interactive owner action; never copy encrypted Ring tokens between accounts.

Transactional verification, password-reset, and uptime messages prefer the
Amazon SES HTTPS API on Railway Hobby, where outbound SMTP is unavailable.
Configure `SPATIALGUARD_SMTP_FROM`, `SPATIALGUARD_SES_REGION`,
`SPATIALGUARD_SES_ACCESS_KEY_ID`, and `SPATIALGUARD_SES_SECRET_ACCESS_KEY`.
On a host that permits SMTP, omit `SPATIALGUARD_SES_REGION` and instead set
`SPATIALGUARD_SMTP_HOST`, `SPATIALGUARD_SMTP_PORT`, and, when required,
`SPATIALGUARD_SMTP_USER` / `SPATIALGUARD_SMTP_PASSWORD`. Tokens are random,
stored only as SHA-256 digests, single-use, and expire after 24 hours for email
verification or 30 minutes for password reset.

`SPATIALGUARD_RELEASE_PROFILE=certification` disables snapshot classification,
time-lapse, uptime history, offline alerts, and private test-video tools by
default. Enable only a reviewed feature with its corresponding variable:
`SPATIALGUARD_FEATURE_CLASSIFICATION`, `SPATIALGUARD_FEATURE_TIMELAPSE`,
`SPATIALGUARD_FEATURE_UPTIME_HISTORY`, or
`SPATIALGUARD_FEATURE_OFFLINE_ALERTS`. The server enforces these flags.

For a judge workspace, set `SPATIALGUARD_DEMO_READ_ONLY=true` and a long random
`SPATIALGUARD_REVIEWER_KEY`. An operator can reseed only the isolated test
account with `python spatialguard/scripts/judge-demo.py <Railway URL>` while the
key is present in the local process environment. The script does not access an
owner's Ring connection.

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
It now provides email verification, password reset, owner data export, deletion
receipts, notification preferences, and Ring-data access history. It does not
yet provide PostgreSQL, backup/restore automation, private object storage,
hosted push notifications, or a high-availability worker. Those remain required
before treating it as a production security service.

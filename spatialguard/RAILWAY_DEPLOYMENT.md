# Railway deployment plan

## Services

Create these Railway services from the repository:

1. `twinforge` — the provider-independent TwinForge API.
2. `spatialguard-api` — the FastAPI application and Ring callback routes.
3. `spatialguard-worker` — the durable replay and Ring event worker.
4. PostgreSQL — the shared production database.

The React build can be served by the API for the first hosted milestone or
deployed as a separate static service after the API is ready.

The root `Dockerfile` is the authoritative build for the first hosted service.
It builds the React bundle with Node 22, installs the pinned Python 3.11
dependencies (including Uvicorn), and starts FastAPI on Railway's `PORT`.
`railway.toml` selects that Dockerfile and checks `/health`.

## Required production changes before deployment

- Replace the local SQLite store with PostgreSQL.
- Replace local-owner browser sessions with hosted authentication.
- Read the Railway `PORT` variable and bind to `0.0.0.0`.
- Remove the localhost-only host and forwarded-request guards.
- Configure CORS for the hosted web origin.
- Point `SPATIALGUARD_TWINFORGE_URL` at the private TwinForge service.
- Move uploads, snapshots, and time-lapse frames to durable object storage.
- Put Ring credentials, OpenAI credentials, and signing secrets in Railway Variables.
- Add database migrations, health checks, backups, and retention controls.

## Variables

Never commit values for these variables:

```text
DATABASE_URL
SPATIALGUARD_TWINFORGE_URL
SPATIALGUARD_TWINFORGE_TOKEN
RING_CLIENT_ID
RING_CLIENT_SECRET
RING_WEBHOOK_SECRET
OPENAI_API_KEY
SPATIALGUARD_CLASSIFIER_MODEL
```

For the first Railway deployment, set `SPATIALGUARD_ALLOWED_HOSTS` to the
generated Railway host including its port only when Railway displays one (for
example, `spatialguard-production.up.railway.app`). Set
`SPATIALGUARD_ORIGIN` to the same `https://` URL. The repository includes a
`railway.toml` start command and `/health` check so Railway does not need to
guess how to launch the Python service.

After the API has a stable HTTPS domain, copy its account-link, token-exchange,
app-home, and webhook URLs into the Ring private-app configuration.

## Before pushing

Review `git status --ignored` and confirm `.env`, credential exports, `.data`,
raw home media, databases, and Android build output are ignored. The repository
scope is described in `REPOSITORY_SCOPE.md`; the shared TwinForge core is needed
by SpatialGuard and should remain available to the build.

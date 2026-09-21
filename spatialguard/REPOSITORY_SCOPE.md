# Repository scope

SpatialGuard is the deployable application in this repository. It intentionally
uses a small set of shared TwinForge packages:

- `spatialguard/` — SpatialGuard API, worker, web app, tests, and docs.
- `services/api/twinforge/` — the provider-independent TwinForge HTTP engine.
- `packages/sdk-python/` — Python client used by the SpatialGuard API.
- `packages/sdk-typescript/` — generated TypeScript contracts used by the web app.
- `packages/spatial-view/` — shared presentation geometry used by the web app.
- Root `pyproject.toml`, `requirements.lock`, `package.json`, and
  `package-lock.json` — workspace build and dependency definitions.

The other root applications, examples, and generated output are not required by
the SpatialGuard production deployment. They may remain in the working folder
while development continues, but should not be added to a future app-only
repository unless they are explicitly needed by a build or test.

Never commit `.env`, provider credential exports, Ring tokens, raw home media,
SQLite databases, Android build output, or `.data/`. The root `.gitignore` and
`.dockerignore` exclude these paths before a Railway build context is sent.

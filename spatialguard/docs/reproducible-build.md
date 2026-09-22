# SpatialGuard reproducible build

The release build uses committed lockfiles and one container entry point. No
developer `.env`, database, upload, media file, or credential CSV is included in
the container context.

## Toolchain

| Tool | Pinned version |
| --- | --- |
| Python | 3.11.9 (`.python-version`; container/CI use Python 3.11) |
| Node.js | 22.22.1 (`.nvmrc`; container/CI use Node 22) |
| npm | 10.2.5 or the version bundled with the pinned Node runtime |
| Java | 21 for Android builds |
| Gradle | 8.14.3 wrapper |
| Android compile/target SDK | 36 |
| Android minimum SDK | 24 |

Python production and test packages are exact pins in `requirements.lock`.
JavaScript packages, including transitive integrity hashes, are locked in
`package-lock.json`. Android libraries are pinned in `variables.gradle` and the
Capacitor packages are pinned in `spatialguard/apps/web/package.json`.

The optional snapshot classifier defaults to `gpt-5.6-luna`. A release must set
`SPATIALGUARD_CLASSIFIER_MODEL` explicitly if classification is enabled and must
record the configured value with its deployment evidence. Classification is
disabled by default in the certification profile.

## Clean build and verification

Run from a clean checkout with Docker available:

```sh
docker build --pull --no-cache -t spatialguard-release .
docker run --rm -d --name spatialguard-release -p 8010:8010 \
  -e SPATIALGUARD_ALLOWED_HOSTS=127.0.0.1:8010 \
  -e SPATIALGUARD_ORIGIN=http://127.0.0.1:8010 spatialguard-release
curl --fail http://127.0.0.1:8010/health
docker stop spatialguard-release
```

The GitHub workflow additionally regenerates both OpenAPI contracts, rejects
contract drift, runs the Python and Playwright suites, builds Android, audits
dependencies and licenses, and scans the full Git history for secrets.

## Release evidence

For each candidate, record the commit SHA, image digest, exact classifier model,
test workflow URL, Android artifact checksum, deployed `/status` response, and
start/end time. A replay result demonstrates deterministic application behavior;
it does not establish real-camera accuracy or Ring certification.

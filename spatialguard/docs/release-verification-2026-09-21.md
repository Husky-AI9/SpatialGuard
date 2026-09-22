# SpatialGuard release verification — 2026-09-21

## Candidate

- Commit tested: `30a0fc2` plus the clean-contract-path fix recorded in the
  following commit amendment.
- Clean checkout: detached Git worktree under the ignored `.data/` directory.
- Developer `.env`, databases, uploads, credentials, and prior `node_modules`
  were absent before installation.

## Toolchain

- Python: 3.11 environment created with `python -m venv .venv`
- Python dependencies: exact `requirements.lock`
- Node release target: 22.22.1 from `.nvmrc`
- Java/Android release target: Android Studio JBR 21.0.10 and the committed
  Gradle wrapper

## Clean-checkout results

| Check | Result | Duration or evidence |
| --- | --- | --- |
| Python and JavaScript install | Pass | 63.3 seconds; `pip install -r requirements.lock` and `npm ci` |
| Backend suite | Pass | 95 passed, 1 skipped in 48.51 seconds (50.9 seconds wall time) |
| Production web build | Pass | 11.1 seconds wall time |
| Contract generation and drift | Pass | Both OpenAPI files and the TypeScript client regenerated without semantic drift |
| Production dependency audit | Pass | `npm audit --omit=dev`: 0 known vulnerabilities |
| Browser suite | Pass | 38 tests in the same candidate source tree before clean-checkout verification |
| Android debug build | Pass | 154 Gradle tasks, Java 21, same candidate source tree |

## Failure found and fixed

The initial clean contract generation could import SpatialGuard but could not
import the local TwinForge SDK. `spatialguard/scripts/contracts.py` now adds the
repository's public TwinForge API/SDK and Ring adapter source roots explicitly.
This makes the documented and CI contract command independent of editable local
installs.

Static UI routes are excluded from the generated OpenAPI document. This removes
contract drift caused by whether the frontend `dist` directory exists when the
schema is generated.

## Limits

Docker was unavailable on the verification workstation, so the no-cache image
build remains a CI check. These results verify deterministic application and
replay behavior; they do not establish Ring certification, real-camera
accuracy, or completion of the manual physical-device matrix.

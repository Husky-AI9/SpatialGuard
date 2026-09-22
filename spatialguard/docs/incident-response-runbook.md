# SpatialGuard incident-response runbook

Use this runbook for suspected credential exposure, unauthorized access, Ring
authorization loss, or a serious provider-processing failure. Record only a
non-sensitive incident reference in commands and audit entries.

## Contain

1. In Railway Variables, set `SPATIALGUARD_MAINTENANCE_MODE=true` and redeploy.
   `/health`, `/status`, and the public legal/support pages remain available;
   application traffic receives a retryable 503 response.
2. Open a Railway shell and preview the session scope:

   ```sh
   python spatialguard/scripts/incident-response.py --all --reason INC-YYYY-NNN
   ```

   Re-run with `--execute` only after the count is reasonable. For one internal
   owner ID, replace `--all` with `--owner OWNER_ID`. Add
   `--disconnect-local-ring` to invalidate encrypted local Ring credentials and
   close local stream records. Then remove SpatialGuard in Ring **My Apps** so
   the provider grant is also revoked.
3. Rotate affected Railway secrets, including `RING_CLIENT_SECRET`,
   `RING_WEBHOOK_SECRET`, `SPATIALGUARD_TOKEN_KEY`, SMTP credentials, reviewer
   credentials, and TwinForge service credentials. Rotation of the token key
   intentionally makes any surviving encrypted Ring token unreadable.

## Preserve and investigate

- Export Railway deployment logs and a copy of the application audit tables
  before retention cleanup runs. Do not export snapshots, raw webhook bodies,
  passwords, tokens, authorization codes, or floor plans into the incident log.
- Record commit SHA, deployment ID, first/last observed time, affected owner
  count, request IDs, Ring event types, and actions taken.
- Review `/health`, owner-visible security activity, Ring event deliveries, and
  pipeline metrics. Logs contain route templates and generated request IDs only.

## Recover

1. Deploy a fixed, scanned commit with rotated variables while maintenance mode
   remains enabled.
2. Verify database health, queue age, dead letters, provider-session leaks, and
   a dedicated staging Ring account. Do not reconnect an owner's Ring account
   without their authorization.
3. Remove maintenance mode and monitor errors and queue latency. Revoked users
   must sign in again; disconnected owners must complete Ring linking again.

## Notify and close

The response command records a pending in-app security notification for affected
owners. Send external notices only through the configured, approved support or
email process. State what occurred, the affected data, containment time, user
action, and support route without exposing another owner or provider payload.
Retain the incident record according to the approved security retention policy,
record follow-up actions, and update this runbook after the review.

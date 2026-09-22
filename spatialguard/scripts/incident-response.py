"""SpatialGuard incident-response controls for a Railway shell.

The command is read-only unless --execute is supplied. It never prints tokens,
password verifiers, Ring payloads, or owner email addresses.
"""

import argparse
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


def now():
    return datetime.now(timezone.utc).isoformat()


parser = argparse.ArgumentParser(description="Revoke SpatialGuard access after a security incident")
parser.add_argument("--db", default="/data/spatialguard/app.sqlite3")
target = parser.add_mutually_exclusive_group(required=True)
target.add_argument("--owner", help="Internal owner ID; do not pass an email address")
target.add_argument("--all", action="store_true", help="Revoke every application session")
parser.add_argument("--reason", required=True, help="Non-sensitive incident reference")
parser.add_argument("--disconnect-local-ring", action="store_true",
                    help="Invalidate local Ring material; also revoke the grant in Ring My Apps")
parser.add_argument("--execute", action="store_true")
args = parser.parse_args()

path = Path(args.db)
if not path.is_file():
    raise SystemExit(f"Database not found: {path}")
if any(ch in args.reason for ch in "@\n\r") or len(args.reason) > 100:
    raise SystemExit("Use a short non-sensitive incident reference without email addresses")

db = sqlite3.connect(path)
db.row_factory = sqlite3.Row
where, params = ("", ()) if args.all else (" WHERE owner=?", (args.owner,))
session_count = db.execute("SELECT count(*) FROM sessions" + where, params).fetchone()[0]
ring_count = db.execute(
    "SELECT count(*) FROM ring_accounts" + ("" if args.all else " WHERE owner=?"), params
).fetchone()[0]
print(json.dumps({
    "mode": "execute" if args.execute else "dry-run",
    "sessions_to_revoke": session_count,
    "ring_accounts_to_invalidate": ring_count if args.disconnect_local_ring else 0,
    "incident_reference": args.reason,
}, indent=2))

if not args.execute:
    raise SystemExit("Dry run only. Re-run with --execute after reviewing the counts.")

with db:
    owners = [row[0] for row in db.execute(
        "SELECT DISTINCT owner FROM sessions" + where, params
    ).fetchall()]
    if args.owner and args.owner not in owners:
        owners.append(args.owner)
    db.execute("DELETE FROM sessions" + where, params)
    if args.disconnect_local_ring:
        accounts = db.execute(
            "SELECT account FROM ring_accounts" + ("" if args.all else " WHERE owner=?"), params
        ).fetchall()
        for account in accounts:
            account_id = account[0]
            db.execute("UPDATE ring_streams SET state='revoked',expires=0 WHERE account=?", (account_id,))
            db.execute("DELETE FROM ring_devices WHERE account=?", (account_id,))
            db.execute("DELETE FROM ring_account_metadata WHERE account=?", (account_id,))
            db.execute("UPDATE ring_accounts SET state='revoked',tokens='' WHERE account=?", (account_id,))
    for owner in owners:
        db.execute("INSERT INTO audit(owner,action,resource,at) VALUES (?,?,?,?)",
                   (owner, "incident.sessions_revoked", args.reason, now()))
        db.execute(
            "INSERT INTO notification_history(owner,category,channel,state,detail,at) VALUES (?,?,?,?,?,?)",
            (owner, "security", "in_app", "pending", "Security access reset; sign in again", now()),
        )
db.close()
print(json.dumps({"status": "completed", "sessions_revoked": session_count}))

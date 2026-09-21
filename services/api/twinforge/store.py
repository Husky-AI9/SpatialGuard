import hashlib
import json
import os
import secrets
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from datetime import datetime, timezone
from uuid import uuid4


def now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def uid(prefix):
    return prefix + "_" + uuid4().hex[:16]


def dump(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


class Store:
    def __init__(self, path=None):
        self.path = Path(
            path or os.environ.get("TWINFORGE_DB", ".data/twinforge.sqlite3")
        )
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.executescript(
                """
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS memberships(token_hash TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, role TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS sites(id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS revisions(id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, site_id TEXT NOT NULL REFERENCES sites(id), parent_id TEXT, state TEXT NOT NULL, version INTEGER NOT NULL, hash TEXT, layout TEXT NOT NULL, created_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS calibrations(id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, revision_id TEXT NOT NULL REFERENCES revisions(id), data TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS observations(tenant_id TEXT NOT NULL, id TEXT NOT NULL, site_id TEXT NOT NULL REFERENCES sites(id), revision_id TEXT NOT NULL REFERENCES revisions(id), observed_at TEXT NOT NULL, arrival INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL, UNIQUE(tenant_id,id));
                CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, site_id TEXT NOT NULL REFERENCES sites(id), metadata TEXT NOT NULL, content BLOB NOT NULL);
                CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, site_id TEXT NOT NULL REFERENCES sites(id), state TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL, output TEXT, error TEXT, attempts INTEGER NOT NULL DEFAULT 0, lease_until REAL, created_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS events(cursor INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT NOT NULL, site_id TEXT NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS idempotency(tenant_id TEXT NOT NULL, operation TEXT NOT NULL, key TEXT NOT NULL, body_hash TEXT NOT NULL, response TEXT NOT NULL, PRIMARY KEY(tenant_id, operation, key));
                CREATE INDEX IF NOT EXISTS idx_observations_site ON observations(tenant_id,site_id,observed_at);
                CREATE INDEX IF NOT EXISTS idx_events_site ON events(tenant_id,site_id,cursor);
            """
            )

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=20, isolation_level=None)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("BEGIN IMMEDIATE")
        try:
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    def create_membership(self, tenant_id, role="owner", token=None):
        token = token or secrets.token_urlsafe(32)
        with self.connect() as db:
            db.execute(
                "INSERT INTO memberships VALUES (?,?,?)",
                (hashlib.sha256(token.encode()).hexdigest(), tenant_id, role),
            )
        return token


def event(db, tenant, site, kind, data):
    db.execute(
        "INSERT INTO events(tenant_id,site_id,kind,data,created_at) VALUES (?,?,?,?,?)",
        (tenant, site, kind, dump(data), now()),
    )


def revision_record(row):
    return {
        "revision_id": row["id"],
        "tenant_id": row["tenant_id"],
        "site_id": row["site_id"],
        "parent_revision_id": row["parent_id"],
        "state": row["state"],
        "version": row["version"],
        "content_hash": row["hash"],
        "created_at": row["created_at"],
        "layout": json.loads(row["layout"]),
    }

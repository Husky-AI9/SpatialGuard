import hashlib
import json
import os
import secrets
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
DATA = Path(os.environ.get("SPATIALGUARD_DATA_DIR", ROOT / ".data")) / "spatialguard"


def now():
    return datetime.now(timezone.utc).isoformat()


def uid(prefix):
    return prefix + "_" + secrets.token_hex(10)


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def dump(value):
    return json.dumps(value, separators=(",", ":"))


class Store:
    def __init__(self, path=None):
        self.path = Path(path or os.environ.get("SPATIALGUARD_DB", DATA / "app.sqlite3"))
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.executescript('''
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS sites (id TEXT PRIMARY KEY, owner TEXT NOT NULL, data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, owner TEXT NOT NULL, digest TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL, kind TEXT NOT NULL, expires REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS pairing (digest TEXT PRIMARY KEY, owner TEXT NOT NULL, expires REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS attempts (peer TEXT PRIMARY KEY, starts REAL NOT NULL, count INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, site_id TEXT NOT NULL, request_id TEXT NOT NULL,
                state TEXT NOT NULL, payload TEXT NOT NULL, lease REAL NOT NULL DEFAULT 0,
                attempts INTEGER NOT NULL DEFAULT 0, error TEXT, UNIQUE(site_id,request_id));
            CREATE TABLE IF NOT EXISTS incidents (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL,
                site_id TEXT NOT NULL, run_id TEXT UNIQUE NOT NULL, data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS plans (job_id TEXT PRIMARY KEY, owner TEXT NOT NULL,
                engine_site TEXT NOT NULL, name TEXT NOT NULL, at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS evidence (id TEXT PRIMARY KEY, site_id TEXT NOT NULL, data TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT NOT NULL,
                kind TEXT NOT NULL, resource TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL,
                action TEXT NOT NULL, resource TEXT NOT NULL, at TEXT NOT NULL);
            ''')

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=15)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()


def event(db, site, kind, resource):
    db.execute("INSERT INTO events(site_id,kind,resource) VALUES (?,?,?)", (site, kind, resource))


def audit(db, owner, action, resource):
    db.execute("INSERT INTO audit(owner,action,resource,at) VALUES (?,?,?,?)", (owner, action, resource, now()))

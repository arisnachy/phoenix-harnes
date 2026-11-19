"""Optional SQLite-backed PHOENIX manual relay. No network or browser access.

This is a separate backend from the earlier Node JSON prototype. Never run them
as if they shared a STOP/approval state. The MCP and Tk UI below use THIS backend.
"""
from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone
import re
import hashlib
import json
from pathlib import Path
import sqlite3
from typing import Any
from uuid import uuid4

from jsonschema import Draft202012Validator, FormatChecker

SCHEMA_PATH = Path(__file__).resolve().parents[1] / "schema" / "phoenix-envelope.schema.json"
SCHEMA = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
VALIDATOR = Draft202012Validator(SCHEMA, format_checker=FormatChecker())
MAX_TURNS = 12
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.I)
UTC_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def validate_envelope(envelope: dict[str, Any]) -> None:
    """Validate the EXACT shared JSON Schema and additional JS guard invariants."""
    if not isinstance(envelope, dict):
        raise ValueError("Envelope must be an object")
    issues = list(VALIDATOR.iter_errors(envelope))
    if issues:
        raise ValueError(f"Invalid PhoenixEnvelope: {issues[0].message}")
    if envelope["sender"] == envelope["recipient"]:
        raise ValueError("Sender and recipient must differ")
    if (envelope["turn"] == 1) != (envelope["reply_to"] is None):
        raise ValueError("First turn must have no reply, later turns must have reply")
    if not envelope["payload"]["text"].strip():
        raise ValueError("Empty payload")
    if not UTC_RE.fullmatch(envelope["created_at"]):
        raise ValueError("Timestamp must be in UTC Z format")
    for key in ("message_id", "thread_id"):
        if not UUID_RE.fullmatch(envelope[key]):
            raise ValueError(f"Invalid UUID: {key}")
    if envelope["reply_to"] is not None and not UUID_RE.fullmatch(envelope["reply_to"]):
        raise ValueError("Invalid reply UUID")


class PhoenixSQLiteStore:
    """Transactions serialize approvals, STOP and message queue operations."""

    def __init__(self, path: Path | str | None = None):
        self.path = Path(path) if path else Path.home() / ".phoenix" / "auth-bridge" / "sqlite" / "state.db"
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path, timeout=15, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA busy_timeout=15000")
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    @contextmanager
    def _connection(self):
        conn = self._connect()
        try:
            yield conn
        finally:
            conn.close()

    def _init_db(self) -> None:
        with self._connection() as conn:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS system_state (
                    key TEXT PRIMARY KEY, value TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS envelopes (
                    message_id TEXT PRIMARY KEY,
                    thread_id TEXT NOT NULL,
                    turn INTEGER NOT NULL CHECK(turn BETWEEN 1 AND 12),
                    reply_to TEXT UNIQUE,
                    sender TEXT NOT NULL,
                    recipient TEXT NOT NULL,
                    intent TEXT NOT NULL,
                    origin TEXT NOT NULL,
                    body_json TEXT NOT NULL,
                    digest TEXT NOT NULL,
                    status TEXT NOT NULL CHECK(status IN
                      ('pending','approved','delivered','rejected','revoked_by_stop')),
                    created_at TEXT NOT NULL,
                    approved_at TEXT, delivered_at TEXT,
                    UNIQUE(thread_id, turn)
                );
                CREATE TABLE IF NOT EXISTS audit_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    at TEXT NOT NULL,
                    action TEXT NOT NULL,
                    message_id TEXT,
                    thread_id TEXT,
                    digest TEXT
                );
                INSERT OR IGNORE INTO system_state(key,value) VALUES('stopped','1');
            """)

    @contextmanager
    def _transaction(self):
        conn = self._connect()
        try:
            conn.execute("BEGIN IMMEDIATE")
            yield conn
            conn.execute("COMMIT")
        except Exception:
            if conn.in_transaction:
                conn.execute("ROLLBACK")
            raise
        finally:
            conn.close()

    @staticmethod
    def _active(conn: sqlite3.Connection) -> None:
        row = conn.execute("SELECT value FROM system_state WHERE key='stopped'").fetchone()
        if row is None or row["value"] != "0":
            raise RuntimeError("STOP_ACTIVE: bridge disabled; operator must resume")

    @staticmethod
    def _event(conn, action: str, envelope: dict | None = None, digest: str | None = None):
        conn.execute("INSERT INTO audit_events(at,action,message_id,thread_id,digest) VALUES(?,?,?,?,?)",
                     (now_iso(), action, envelope["message_id"] if envelope else None,
                      envelope["thread_id"] if envelope else None, digest))

    def is_stopped(self) -> bool:
        with self._connection() as conn:
            row = conn.execute("SELECT value FROM system_state WHERE key='stopped'").fetchone()
            return row is None or row["value"] != "0"

    def set_stopped(self, stopped: bool, *, operator: bool = False) -> int:
        """Never expose as an MCP tool. `operator` is not remote authentication."""
        if not operator:
            raise PermissionError("Operator console action required")
        with self._transaction() as conn:
            conn.execute("UPDATE system_state SET value=? WHERE key='stopped'", ("1" if stopped else "0",))
            revoked = 0
            if stopped:
                revoked = conn.execute("UPDATE envelopes SET status='revoked_by_stop' WHERE status IN ('pending','approved')").rowcount
            self._event(conn, "operator_stop" if stopped else "operator_resume")
            return revoked

    def _insert(self, envelope: dict[str, Any]) -> dict[str, Any]:
        validate_envelope(envelope)
        blob = json.dumps(envelope, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        digest = hashlib.sha256(blob.encode("utf-8")).hexdigest()
        with self._transaction() as conn:
            self._active(conn)
            if envelope["reply_to"] is None:
                existing = conn.execute("SELECT 1 FROM envelopes WHERE thread_id=?", (envelope["thread_id"],)).fetchone()
                if existing:
                    raise ValueError("Thread already exists; first turn must be unique")
            else:
                prev = conn.execute("SELECT * FROM envelopes WHERE message_id=?", (envelope["reply_to"],)).fetchone()
                if prev is None or prev["status"] != "delivered":
                    raise ValueError("Previous turn must have confirmed manual delivery")
                if prev["thread_id"] != envelope["thread_id"] or prev["turn"] + 1 != envelope["turn"]:
                    raise ValueError("Thread or turn sequence invalid")
                if prev["recipient"] != envelope["sender"] or prev["sender"] != envelope["recipient"]:
                    raise ValueError("Reply direction must alternate")
            if envelope["turn"] > MAX_TURNS:
                raise ValueError("Turn limit exceeded")
            conn.execute("""INSERT INTO envelopes
                (message_id,thread_id,turn,reply_to,sender,recipient,intent,origin,body_json,digest,status,created_at)
                VALUES(?,?,?,?,?,?,?,?,?,?,'pending',?)""",
                (envelope["message_id"], envelope["thread_id"], envelope["turn"], envelope["reply_to"],
                 envelope["sender"], envelope["recipient"], envelope["intent"], envelope["origin"],
                 blob, digest, envelope["created_at"]))
            self._event(conn, "queued", envelope, digest)
        return {"message_id": envelope["message_id"], "thread_id": envelope["thread_id"],
                "turn": envelope["turn"], "status": "pending"}

    def enqueue_validated_envelope(self, envelope: dict[str, Any]):
        """All public queue entrypoints validate. No optional missing validator."""
        return self._insert(envelope)

    def propose(self, *, sender: str, recipient: str, intent: str, text: str,
                reply_to: str | None = None, origin: str = "manual-user-entry") -> dict[str, Any]:
        if origin not in ("manual-user-entry", "mcp-agent-proposal"):
            raise ValueError("Origin invalid")
        if reply_to:
            with self._connection() as conn:
                prev = conn.execute("SELECT thread_id,turn FROM envelopes WHERE message_id=?", (reply_to,)).fetchone()
            if prev is None:
                raise ValueError("Unknown reply reference")
            thread_id, turn = prev["thread_id"], prev["turn"] + 1
        else:
            thread_id, turn = str(uuid4()), 1
        envelope = {"protocol": "phoenix-auth-bridge", "version": 1,
                    "message_id": str(uuid4()), "thread_id": thread_id, "turn": turn,
                    "sender": sender, "recipient": recipient, "intent": intent,
                    "payload": {"text": text}, "created_at": now_iso(),
                    "origin": origin, "reply_to": reply_to}
        return self._insert(envelope)

    def get_message(self, message_id: str) -> dict | None:
        with self._connection() as conn:
            row = conn.execute("SELECT * FROM envelopes WHERE message_id=?", (message_id,)).fetchone()
            return self._hydrate(row) if row else None

    @staticmethod
    def _hydrate(row) -> dict:
        d = dict(row)
        d["envelope"] = json.loads(d.pop("body_json"))
        return d

    def list_conversation(self, thread_id: str) -> list[dict]:
        with self._connection() as conn:
            return [self._hydrate(r) for r in conn.execute("SELECT * FROM envelopes WHERE thread_id=? ORDER BY turn", (thread_id,))]

    def list_recent(self, limit: int = 100) -> list[dict]:
        with self._connection() as conn:
            return [self._hydrate(r) for r in conn.execute("SELECT * FROM envelopes ORDER BY created_at DESC LIMIT ?", (min(max(limit, 1), 100),))]

    def approve(self, message_id: str, *, operator: bool = False) -> None:
        if not operator:
            raise PermissionError("Human operator action required")
        with self._transaction() as conn:
            self._active(conn)
            row = conn.execute("SELECT * FROM envelopes WHERE message_id=?", (message_id,)).fetchone()
            if row is None or row["status"] != "pending":
                raise ValueError("Not pending or unknown message")
            conn.execute("UPDATE envelopes SET status='approved',approved_at=? WHERE message_id=?",
                         (now_iso(), message_id))
            self._event(conn, "operator_approved", json.loads(row["body_json"]), row["digest"])

    def reject(self, message_id: str, *, operator: bool = False) -> None:
        if not operator:
            raise PermissionError("Human operator action required")
        with self._transaction() as conn:
            row = conn.execute("SELECT * FROM envelopes WHERE message_id=?", (message_id,)).fetchone()
            if row is None or row["status"] not in ("pending", "approved"):
                raise ValueError("Not rejectable")
            conn.execute("UPDATE envelopes SET status='rejected' WHERE message_id=?", (message_id,))
            self._event(conn, "operator_rejected", json.loads(row["body_json"]), row["digest"])

    def approved_inbox(self, recipient: str) -> list[dict]:
        with self._connection() as conn:
            self._active(conn)
            return [self._hydrate(r) for r in conn.execute(
                "SELECT * FROM envelopes WHERE recipient=? AND status='approved' ORDER BY created_at", (recipient,))]

    def approved_for_manual_copy(self, message_id: str) -> dict:
        with self._connection() as conn:
            self._active(conn)
            row = conn.execute("SELECT * FROM envelopes WHERE message_id=?", (message_id,)).fetchone()
            if row is None or row["status"] != "approved":
                raise ValueError("Message is not approved or was revoked")
            return json.loads(row["body_json"])

    def mark_delivered(self, message_id: str, *, operator: bool = False) -> None:
        if not operator:
            raise PermissionError("Human delivery confirmation required")
        with self._transaction() as conn:
            self._active(conn)
            row = conn.execute("SELECT * FROM envelopes WHERE message_id=?", (message_id,)).fetchone()
            if row is None or row["status"] != "approved":
                raise ValueError("Message not approved or was revoked")
            conn.execute("UPDATE envelopes SET status='delivered',delivered_at=? WHERE message_id=?",
                         (now_iso(), message_id))
            self._event(conn, "operator_confirmed_delivery", json.loads(row["body_json"]), row["digest"])

    def audit(self) -> list[dict]:
        with self._connection() as conn:
            return [dict(r) for r in conn.execute("SELECT * FROM audit_events ORDER BY id DESC LIMIT 100")]

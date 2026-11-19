from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from uuid import uuid4

from gemini_bridge.sqlite_store import PhoenixSQLiteStore, validate_envelope


class TestSQLiteBridge(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = PhoenixSQLiteStore(Path(self.tmp.name) / "state.db")

    def tearDown(self):
        self.tmp.cleanup()

    def resume(self):
        self.store.set_stopped(False, operator=True)

    def make_first(self, text="secret", origin="manual-user-entry"):
        return self.store.propose(sender="chatgpt", recipient="gemini", intent="proposal", text=text, origin=origin)

    def test_stopped_by_default_and_no_anonymous_authorization(self):
        self.assertTrue(self.store.is_stopped())
        with self.assertRaises(RuntimeError):
            self.make_first()
        with self.assertRaises(PermissionError):
            self.store.set_stopped(False)
        self.resume()
        m = self.make_first()
        with self.assertRaises(PermissionError):
            self.store.approve(m["message_id"])
        with self.assertRaises(ValueError):
            self.store.approved_for_manual_copy(m["message_id"])
        with self.assertRaises(PermissionError):
            self.store.mark_delivered(m["message_id"])
        self.assertEqual(self.store.approved_inbox("gemini"), [])

    def test_human_approval_delivery_audit_and_stop_revocation(self):
        self.resume()
        m = self.make_first("confidential-secret-for-testing")
        self.store.approve(m["message_id"], operator=True)
        self.assertEqual(len(self.store.approved_inbox("gemini")), 1)
        self.assertEqual(self.store.approved_for_manual_copy(m["message_id"])["payload"]["text"], "confidential-secret-for-testing")
        count = self.store.set_stopped(True, operator=True)
        self.assertEqual(count, 1)
        self.assertEqual(self.store.get_message(m["message_id"])["status"], "revoked_by_stop")
        with self.assertRaises(RuntimeError):
            self.store.approved_inbox("gemini")
        self.resume()
        with self.assertRaises(ValueError):
            self.store.approve(m["message_id"], operator=True)
        self.assertNotIn("confidential-secret-for-testing", json.dumps(self.store.audit()))
        # This is NOT an encrypted database: the envelope payload is stored locally in plaintext.
        self.assertIn("confidential-secret-for-testing", self.store.get_message(m["message_id"])["envelope"]["payload"]["text"])

    def test_reply_chain_and_duplicate_fork_prohibition(self):
        self.resume()
        one = self.make_first()
        with self.assertRaises(ValueError):
            self.store.propose(sender="gemini", recipient="chatgpt", intent="general", text="before delivery", reply_to=one["message_id"])
        self.store.approve(one["message_id"], operator=True)
        self.store.mark_delivered(one["message_id"], operator=True)
        with self.assertRaises(ValueError):
            self.store.propose(sender="chatgpt", recipient="gemini", intent="general", text="wrong direction", reply_to=one["message_id"])
        two = self.store.propose(sender="gemini", recipient="chatgpt", intent="general", text="reply", reply_to=one["message_id"])
        self.assertEqual(two["thread_id"], one["thread_id"])
        self.assertEqual(two["turn"], 2)
        with self.assertRaises(sqlite3.IntegrityError):
            self.store.propose(sender="gemini", recipient="chatgpt", intent="general", text="fork", reply_to=one["message_id"])
        self.store.approve(two["message_id"], operator=True)
        self.store.mark_delivered(two["message_id"], operator=True)
        last = two
        for t in range(3, 13):
            next_m = self.store.propose(sender="chatgpt" if t % 2 else "gemini", recipient="gemini" if t % 2 else "chatgpt", intent="general", text=str(t), reply_to=last["message_id"])
            self.assertEqual(next_m["turn"], t)
            self.store.approve(next_m["message_id"], operator=True)
            self.store.mark_delivered(next_m["message_id"], operator=True)
            last = next_m
        with self.assertRaises(ValueError):
            self.store.propose(sender="chatgpt", recipient="gemini", intent="general", text="13", reply_to=last["message_id"])

    def test_strict_schema_and_mcp_origin(self):
        self.resume()
        m = self.make_first(origin="mcp-agent-proposal")
        envelope = self.store.get_message(m["message_id"])["envelope"]
        validate_envelope(envelope)
        for invalid in [dict(envelope, danger="token"), dict(envelope, origin="web-session"),
                        dict(envelope, payload={"body": "wrong"}), dict(envelope, payload={"text": " "}),
                        dict(envelope, sender="gemini"), dict(envelope, version=2)]:
            with self.assertRaises(ValueError):
                self.store.enqueue_validated_envelope(invalid)
        with self.assertRaises(ValueError):
            self.make_first(text="X" * 12001)

    def test_concurrent_stop_cannot_leave_approvals_behind(self):
        self.resume()
        ids = [self.make_first(str(i))["message_id"] for i in range(20)]
        def try_approve(mid):
            try:
                self.store.approve(mid, operator=True)
            except (RuntimeError, ValueError):
                pass
        with ThreadPoolExecutor(max_workers=8) as pool:
            futures = [pool.submit(try_approve, mid) for mid in ids]
            futures.append(pool.submit(self.store.set_stopped, True, operator=True))
            for future in futures:
                future.result()
        self.assertTrue(self.store.is_stopped())
        self.assertEqual(sum(self.store.get_message(mid)["status"] == "approved" for mid in ids), 0)
        self.assertEqual(sum(self.store.get_message(mid)["status"] == "pending" for mid in ids), 0)


if __name__ == "__main__":
    unittest.main()

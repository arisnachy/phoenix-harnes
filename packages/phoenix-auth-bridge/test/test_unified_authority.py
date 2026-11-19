"""Cross-process tests: Node CLI, Python store and projection share ONE DB."""
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest

from gemini_bridge.sqlite_store import PhoenixSQLiteStore

ROOT = Path(__file__).resolve().parents[1]
CLI = ROOT / "src" / "cli.mjs"


class TestUnifiedAuthority(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.root = Path(self.tempdir.name)
        self.env = {**os.environ, "PHOENIX_BRIDGE_HOME": str(self.root),
                    "PHOENIX_BRIDGE_PYTHON": os.environ.get("PHOENIX_BRIDGE_PYTHON", "python3")}
        self.store = PhoenixSQLiteStore(self.root / "sqlite" / "state.db")

    def tearDown(self):
        self.tempdir.cleanup()

    def cli(self, *args, input_text="", ok=True):
        result = subprocess.run(["node", str(CLI), *args], cwd=ROOT, env=self.env,
                                input=input_text, text=True, capture_output=True, timeout=20)
        if ok:
            self.assertEqual(result.returncode, 0, result.stderr)
        else:
            self.assertNotEqual(result.returncode, 0, result.stdout)
        return result

    def test_single_authority_stop_and_manual_relay(self):
        self.assertTrue(json.loads(self.cli("status").stdout)["stop_active"])
        self.cli("prepare", "--from", "chatgpt", "--to", "gemini", input_text="SECRET", ok=False)
        self.cli("resume")
        queued = self.cli("prepare", "--from", "chatgpt", "--to", "gemini", input_text="SECRET")
        message_id = re.search(r"Pending ([\w-]{36})", queued.stdout).group(1)
        self.assertEqual(self.store.get_message(message_id)["status"], "pending")
        self.cli("relay", "--id", message_id, ok=False)
        self.store.approve(message_id, operator=True)  # Tk uses same method, unlike old JSON CLI
        self.assertIn("SECRET", self.cli("relay", "--id", message_id).stdout)
        self.cli("stop")
        self.assertTrue(self.store.is_stopped())
        self.assertEqual(self.store.get_message(message_id)["status"], "revoked_by_stop")
        self.cli("relay", "--id", message_id, ok=False)
        snapshot = json.loads((self.root / "sqlite" / "state_snapshot.json").read_text())
        self.assertTrue(snapshot["stop_active"])
        self.assertTrue(snapshot["advisory_only"])
        self.assertEqual(snapshot["turns"][0]["status"], "revoked_by_stop")
        self.assertNotIn("SECRET", json.dumps(snapshot))
        self.assertFalse((self.root / "state.json").exists())

    def test_python_stop_prevents_node_approval_and_resume(self):
        self.cli("resume")
        item = self.store.propose(sender="gemini", recipient="chatgpt", intent="general", text="hello")
        self.store.set_stopped(True, operator=True)
        self.cli("approve", "--id", item["message_id"], ok=False)
        self.cli("resume")
        self.cli("approve", "--id", item["message_id"], ok=False)  # revoked cannot revive
        snapshot = json.loads((self.root / "sqlite" / "state_snapshot.json").read_text())
        self.assertFalse(snapshot["stop_active"])
        self.assertEqual(snapshot["turns"][0]["status"], "revoked_by_stop")


if __name__ == "__main__":
    unittest.main()

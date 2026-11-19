"""Opt-in CLI settings registration must be conservative and non-destructive."""
import json
from pathlib import Path
import sys
import tempfile
import unittest

from gemini_bridge.configure_gemini_cli import generate_server_config, update_settings


ROOT = Path(__file__).resolve().parents[1]


class TestGeminiCliConfig(unittest.TestCase):
    def test_defaults_preview_is_read_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / '.gemini' / 'settings.json'
            server = generate_server_config(ROOT, Path(sys.executable), Path(tmp) / 'state')
            result = update_settings(path, server)
            self.assertFalse(result['applied'])
            self.assertFalse(path.exists())
            self.assertEqual(server['args'], ['-m', 'gemini_bridge.mcp_server'])
            self.assertEqual(server['includeTools'], ['propose_bridge_draft', 'read_approved_bridge_inbox'])
            self.assertIs(server['trust'], False)

    def test_merge_preserves_user_settings_and_backs_up(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / '.gemini' / 'settings.json'
            path.parent.mkdir(parents=True)
            original = {'ui': {'theme': 'custom'}, 'mcpServers': {'my-other-server': {'command': 'sample'}}}
            raw = json.dumps(original).encode()
            path.write_bytes(raw)
            cfg = generate_server_config(ROOT, Path(sys.executable), Path(tmp) / 'state')
            result = update_settings(path, cfg, apply=True)
            new = json.loads(path.read_text(encoding='utf-8'))
            self.assertEqual(new['ui'], original['ui'])
            self.assertEqual(new['mcpServers']['my-other-server'], original['mcpServers']['my-other-server'])
            self.assertEqual(new['mcpServers']['phoenix-auth-bridge'], cfg)
            self.assertEqual(Path(result['backup_path']).read_bytes(), raw)
            with self.assertRaisesRegex(ValueError, 'already configured'):
                update_settings(path, cfg, apply=True)
            result2 = update_settings(path, cfg, apply=True, replace_existing=True)
            self.assertTrue(result2['applied'])

    def test_invalid_existing_settings_fail_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'settings.json'
            path.write_text('{broken', encoding='utf-8')
            cfg = generate_server_config(ROOT, Path(sys.executable), Path(tmp) / 'state')
            with self.assertRaisesRegex(ValueError, 'invalid JSON'):
                update_settings(path, cfg, apply=True)
            self.assertEqual(path.read_text(), '{broken')

    def test_incompatible_settings_types_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'settings.json'
            path.write_text('{"mcpServers":[]}', encoding='utf-8')
            cfg = generate_server_config(ROOT, Path(sys.executable), Path(tmp) / 'state')
            with self.assertRaises(ValueError):
                update_settings(path, cfg, apply=True)
            self.assertEqual(json.loads(path.read_text()), {'mcpServers': []})


if __name__ == '__main__':
    unittest.main()

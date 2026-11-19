"""Actual MCP v1 stdio client/server protocol test (no model account or browser).

Run on Linux and Windows CI with mcp>=1.28,<2 installed. Test cases fail
rather than silently skip when PHOENIX_REQUIRE_MCP=1 is set in CI.
"""
from __future__ import annotations

import asyncio
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest

from gemini_bridge.sqlite_store import PhoenixSQLiteStore

HAS_MCP = importlib.util.find_spec('mcp') is not None
if not HAS_MCP and os.getenv('PHOENIX_REQUIRE_MCP') == '1':
    raise RuntimeError('MCP SDK is missing; this CI protocol test MUST run')

if HAS_MCP:
    from mcp import ClientSession, StdioServerParameters, types
    from mcp.client.stdio import stdio_client

ROOT = Path(__file__).resolve().parents[1]


def as_dict(response):
    if response.isError:
        raise AssertionError(f'MCP tool returned error: {response.content!r}')
    data = getattr(response, 'structuredContent', None)
    if isinstance(data, dict):
        if 'result' in data and isinstance(data['result'], dict):
            return data['result']
        if 'status' in data:
            return data
    for part in response.content:
        if hasattr(part, 'text'):
            try:
                parsed = json.loads(part.text)
            except (ValueError, TypeError):
                continue
            if isinstance(parsed, dict):
                return parsed.get('result', parsed)
    raise AssertionError(f'Unrecognized MCP tool output: {response!r}')


@unittest.skipUnless(HAS_MCP, 'Optional mcp SDK unavailable outside CI')
class TestMcpStdio(unittest.TestCase):
    def test_stdio_handshake_approval_stop(self):
        with tempfile.TemporaryDirectory() as directory:
            store = PhoenixSQLiteStore(Path(directory) / 'sqlite' / 'state.db')
            self.assertTrue(store.is_stopped(), 'Bridge must be stopped at first launch')

            async def protocol():
                params = StdioServerParameters(
                    command=sys.executable,
                    args=['-m', 'gemini_bridge.mcp_server'],
                    env={**os.environ, 'PHOENIX_BRIDGE_HOME': directory,
                         'PYTHONPATH': str(ROOT), 'PYTHONUTF8': '1'},
                )
                async with stdio_client(params) as (read, write):
                    async with ClientSession(read, write) as client:
                        await client.initialize()
                        listed = await client.list_tools()
                        names = {tool.name for tool in listed.tools}
                        self.assertEqual(names, {'propose_bridge_draft', 'read_approved_bridge_inbox'})
                        args = {'sender': 'gemini', 'recipient': 'chatgpt',
                                'intent': 'general', 'text': 'Saludos desde stdio MCP'}
                        blocked = as_dict(await client.call_tool('propose_bridge_draft', arguments=args))
                        self.assertEqual(blocked['status'], 'BLOCKED')
                        store.set_stopped(False, operator=True)
                        queued = as_dict(await client.call_tool('propose_bridge_draft', arguments=args))
                        self.assertEqual(queued['status'], 'pending')
                        mid = queued['message_id']
                        self.assertEqual(store.get_message(mid)['status'], 'pending')
                        inbox = as_dict(await client.call_tool('read_approved_bridge_inbox',
                                                               arguments={'recipient': 'chatgpt'}))
                        self.assertEqual(inbox['messages'], [])
                        store.approve(mid, operator=True)
                        inbox = as_dict(await client.call_tool('read_approved_bridge_inbox',
                                                               arguments={'recipient': 'chatgpt'}))
                        self.assertEqual(len(inbox['messages']), 1)
                        self.assertEqual(inbox['messages'][0]['message_id'], mid)
                        store.set_stopped(True, operator=True)
                        final = as_dict(await client.call_tool('read_approved_bridge_inbox',
                                                               arguments={'recipient': 'chatgpt'}))
                        self.assertEqual(final['status'], 'BLOCKED')
                        self.assertEqual(final['messages'], [])
                        self.assertEqual(store.get_message(mid)['status'], 'revoked_by_stop')
                        self.assertNotIn(args['text'], json.dumps(store.audit(), ensure_ascii=False))

            asyncio.run(asyncio.wait_for(protocol(), timeout=60))

if __name__ == '__main__':
    unittest.main()

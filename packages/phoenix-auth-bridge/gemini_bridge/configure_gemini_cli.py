"""Opt-in Gemini CLI stdio MCP registration for PHOENIX AUTH BRIDGE.

Never accesses Google or OpenAI sessions, never reads browser data, never runs
Gemini or grants operator privileges. The operator must run --apply explicitly.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
from typing import Any

SERVER_NAME = 'phoenix-auth-bridge'
TOOL_ALLOWLIST = ['propose_bridge_draft', 'read_approved_bridge_inbox']


def generate_server_config(bridge_root: Path, python_path: Path, bridge_home: Path) -> dict[str, Any]:
    bridge_root = bridge_root.resolve(strict=True)
    python_path = python_path.resolve(strict=True)
    bridge_home = bridge_home.expanduser().resolve()
    if not (bridge_root / 'gemini_bridge' / 'mcp_server.py').is_file():
        raise ValueError('Not a PHOENIX AUTH BRIDGE package directory: missing gemini_bridge/mcp_server.py')
    if not python_path.is_file():
        raise ValueError('Python interpreter is not a file')
    return {
        'command': str(python_path),
        'args': ['-m', 'gemini_bridge.mcp_server'],
        'cwd': str(bridge_root),
        'env': {'PYTHONUTF8': '1', 'PHOENIX_BRIDGE_HOME': str(bridge_home)},
        'trust': False,
        'includeTools': TOOL_ALLOWLIST.copy(),
    }


def read_settings(path: Path) -> tuple[dict[str, Any], bytes | None]:
    try:
        original = path.read_bytes()
    except FileNotFoundError:
        return {}, None
    try:
        value = json.loads(original.decode('utf-8-sig'))
    except (ValueError, UnicodeDecodeError) as exc:
        raise ValueError(f'Existing Gemini settings are invalid JSON; left unchanged: {path}') from exc
    if not isinstance(value, dict):
        raise ValueError('Gemini settings root must be an object; left unchanged')
    if 'mcpServers' in value and not isinstance(value['mcpServers'], dict):
        raise ValueError('Existing mcpServers must be an object; left unchanged')
    return value, original


def update_settings(path: Path, server_config: dict[str, Any], *, apply: bool = False,
                    replace_existing: bool = False) -> dict[str, Any]:
    """Preview by default. Save to user-owned settings ONLY on explicit --apply."""
    path = path.expanduser().absolute()
    current, original = read_settings(path)
    servers = current.setdefault('mcpServers', {})
    if SERVER_NAME in servers and not replace_existing:
        raise ValueError('Server already configured. Use --replace-existing only if you intend to replace its settings.')
    servers[SERVER_NAME] = server_config
    if not apply:
        return {'applied': False, 'settings_path': str(path), 'server': server_config, 'would_replace_existing': original is not None}

    path.parent.mkdir(parents=True, exist_ok=True)
    # Recheck after preparing data so an earlier read cannot silently clobber a
    # settings update from another process. This is not a substitute for a
    # cross-process lock when multiple independent installers race.
    latest = path.read_bytes() if path.exists() else None
    if latest != original:
        raise RuntimeError('Gemini settings changed during setup; no changes written')

    backup: Path | None = None
    if original is not None:
        stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
        backup = path.with_name(path.name + '.bak.' + stamp)
        with backup.open('xb') as saved:
            saved.write(original)
            saved.flush()
            os.fsync(saved.fileno())
        if os.name != 'nt':
            backup.chmod(0o600)

    fd, temp_name = tempfile.mkstemp(prefix='.phoenix-gemini-settings-', suffix='.tmp', dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8', newline='\n') as output:
            json.dump(current, output, indent=2, ensure_ascii=False)
            output.write('\n')
            output.flush()
            os.fsync(output.fileno())
        os.replace(temp_name, path)
        if os.name != 'nt':
            path.chmod(0o600)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)
    return {'applied': True, 'settings_path': str(path), 'backup_path': str(backup) if backup else None,
            'server': server_config}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description='Explicit, safe Gemini CLI MCP server registration')
    parser.add_argument('--bridge-root', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--python-path', type=Path, default=Path(sys.executable))
    parser.add_argument('--bridge-home', type=Path, default=Path.home() / '.phoenix' / 'auth-bridge')
    parser.add_argument('--settings-path', type=Path, default=Path.home() / '.gemini' / 'settings.json')
    parser.add_argument('--apply', action='store_true', help='Explicitly write settings (preview is default)')
    parser.add_argument('--replace-existing', action='store_true', help='Replace an existing bridge entry')
    args = parser.parse_args(argv)
    try:
        config = generate_server_config(args.bridge_root, args.python_path, args.bridge_home)
        result = update_settings(args.settings_path, config, apply=args.apply,
                                 replace_existing=args.replace_existing)
    except (OSError, ValueError, RuntimeError) as exc:
        print(f'PHOENIX Gemini setup: {exc}', file=sys.stderr)
        return 1
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

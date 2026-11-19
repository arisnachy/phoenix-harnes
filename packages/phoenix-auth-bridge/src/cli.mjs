#!/usr/bin/env node
// Operator-only wrapper; Python SQLite is the single authoritative store.
// This process never reads the legacy state.json or authorizes from the JSON snapshot.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const home = process.env.PHOENIX_BRIDGE_HOME || join(homedir(), '.phoenix', 'auth-bridge');
const interpreter = process.env.PHOENIX_BRIDGE_PYTHON || (process.platform === 'win32' ? 'py' : 'python3');
const prefix = process.platform === 'win32' && interpreter.toLowerCase() === 'py' ? ['-3'] : [];
const command = process.argv.slice(2);
if (existsSync(join(home, 'state.json'))) {
  console.error('NOTICE: Legacy state.json remains untouched; the single authority is sqlite/state.db.');
}
const chunks = [];
if (command[0] === 'prepare') {
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
}
const result = spawnSync(interpreter, [...prefix, '-m', 'gemini_bridge.authority_cli', ...command], {
  cwd: root, input: Buffer.concat(chunks), encoding: 'utf8',
  env: { ...process.env, PHOENIX_BRIDGE_HOME: home },
  maxBuffer: 2 * 1024 * 1024, timeout: 15000,
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) process.stderr.write(`PHOENIX AUTH BRIDGE: Python launch failed: ${result.error.message}\n`);
process.exitCode = result.status ?? 1;

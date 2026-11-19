#!/usr/bin/env node
import { existsSync, lstatSync, mkdirSync, openSync, closeSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { approve, emptyState, markDelivered, metadata, prepare, reject, relayText, resume, stop, validateState } from './guard.mjs';

// No network, browser automation, OAuth/session reuse, clipboard monitoring or model invocation.
const directory = process.env.PHOENIX_BRIDGE_HOME || join(homedir(), '.phoenix', 'auth-bridge');
const store = join(directory, 'state.json');
const lock = join(directory, 'state.lock');
const [command, ...args] = process.argv.slice(2);
function option(name, fallback = undefined) {
  const idx = args.indexOf(`--${name}`);
  return idx < 0 ? fallback : args[idx + 1];
}
function init() {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (lstatSync(directory).isSymbolicLink()) throw new Error('Refusing symlink store');
}
function load() {
  const state = existsSync(store) ? JSON.parse(readFileSync(store, 'utf8')) : emptyState();
  validateState(state);
  return state;
}
function save(state) {
  const tmp = join(directory, `.state.${randomUUID()}.tmp`);
  writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600, flag: 'wx' });
  try { renameSync(tmp, store); } finally { if (existsSync(tmp)) unlinkSync(tmp); }
}
function mutate(fn) {
  init();
  const fd = openSync(lock, 'wx', 0o600); // Single local writer; a stale lock must be inspected manually.
  try {
    const state = load();
    const out = fn(state);
    save(state);
    return out;
  } finally { closeSync(fd); unlinkSync(lock); }
}
async function stdinText() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}
const usage = `PHOENIX AUTH BRIDGE (manual, no APIs)
  status
  resume                 # user enables local relay
  stop                   # user halts relay; approvals revoked
  prepare --from chatgpt --to gemini --intent proposal [--reply-to UUID] < message.txt
  approve --id UUID      # explicit local approval
  relay --id UUID        # print approved text for the USER to paste
  delivered --id UUID    # user confirms they pasted it
  reject --id UUID
All messages are user-supplied labels, NOT verified service identities.
The data store is local; Windows ACL protection must be verified for shared machines.`;
try {
  if (!command || command === 'help') console.log(usage);
  else if (command === 'status') { init(); console.log(JSON.stringify(metadata(load()), null, 2)); }
  else if (command === 'resume') { mutate((s) => resume(s, 'arisnachy')); console.log('Local relay enabled. No automatic sending.'); }
  else if (command === 'stop') { mutate((s) => stop(s, 'arisnachy')); console.log('STOPPED; pending approvals revoked.'); }
  else if (command === 'prepare') {
    const text = await stdinText();
    const envelope = mutate((s) => prepare(s, { sender: option('from'), recipient: option('to'),
      intent: option('intent', 'general'), text, replyTo: option('reply-to', null) }));
    console.log(`Pending ${envelope.message_id}; approve manually before relay.`);
  }
  else if (command === 'approve') { mutate((s) => approve(s, option('id'), 'arisnachy')); console.log('Approved for manual copying only.'); }
  else if (command === 'relay') { init(); console.log(relayText(load(), option('id'))); }
  else if (command === 'delivered') { mutate((s) => markDelivered(s, option('id'), 'arisnachy')); console.log('Marked delivered by user.'); }
  else if (command === 'reject') { mutate((s) => reject(s, option('id'), 'arisnachy')); console.log('Rejected.'); }
  else { console.error(usage); process.exitCode = 2; }
} catch (error) { console.error(`PHOENIX AUTH BRIDGE: ${error.message}`); process.exitCode = 1; }
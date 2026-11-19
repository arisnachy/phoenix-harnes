import assert from 'node:assert/strict';
import test from 'node:test';
import { approve, emptyState, markDelivered, metadata, prepare, reject, relayText, resume, stop, validateEnvelope } from '../src/guard.mjs';

const ready = () => { const s = emptyState(); resume(s, 'arisnachy'); return s; };

test('fail closed, manual approval, delivery and audit without payloads', () => {
  const s = emptyState();
  assert.throws(() => prepare(s, { sender: 'chatgpt', recipient: 'gemini', text: 'hello' }), /STOPPED/);
  resume(s, 'arisnachy');
  const e = prepare(s, { sender: 'chatgpt', recipient: 'gemini', text: 'secret-sample-string' });
  assert.equal(validateEnvelope(e), true);
  assert.throws(() => relayText(s, e.message_id), /approved/);
  assert.throws(() => approve(s, e.message_id, 'gemini'), /user approval/);
  approve(s, e.message_id, 'arisnachy');
  assert.match(relayText(s, e.message_id), /secret-sample-string/);
  markDelivered(s, e.message_id, 'arisnachy');
  assert.throws(() => relayText(s, e.message_id), /approved/);
  assert.equal(JSON.stringify(metadata(s)).includes('secret-sample-string'), false);
  assert.equal(s.messages[0].status, 'delivered');
});

test('stop revokes approvals, and restart requires new approval', () => {
  const s = ready();
  const e = prepare(s, { sender: 'gemini', recipient: 'chatgpt', text: 'hello' });
  approve(s, e.message_id, 'arisnachy');
  stop(s, 'arisnachy');
  assert.throws(() => relayText(s, e.message_id), /STOPPED/);
  resume(s, 'arisnachy');
  assert.throws(() => relayText(s, e.message_id), /approved/);
  reject(s, e.message_id, 'arisnachy');
  assert.throws(() => approve(s, e.message_id, 'arisnachy'), /not pending/);
});

test('reply chains reject wrong direction, duplicate replies, and unconfirmed delivery', () => {
  const s = ready();
  const first = prepare(s, { sender: 'chatgpt', recipient: 'gemini', text: 'one' });
  assert.throws(() => prepare(s, { sender: 'gemini', recipient: 'chatgpt', text: 'two', replyTo: first.message_id }), /delivered/);
  approve(s, first.message_id, 'arisnachy'); markDelivered(s, first.message_id, 'arisnachy');
  assert.throws(() => prepare(s, { sender: 'chatgpt', recipient: 'gemini', text: 'bad', replyTo: first.message_id }), /Reply sender/);
  const second = prepare(s, { sender: 'gemini', recipient: 'chatgpt', text: 'two', replyTo: first.message_id });
  assert.equal(second.thread_id, first.thread_id);
  assert.equal(second.turn, 2);
  assert.throws(() => prepare(s, { sender: 'gemini', recipient: 'chatgpt', text: 'dup', replyTo: first.message_id }), /already exists/);
});

test('size, extras, and turn limit cannot bypass validation', () => {
  const s = ready();
  assert.throws(() => prepare(s, { sender: 'chatgpt', recipient: 'gemini', text: 'x'.repeat(12001) }), /Payload/);
  const e = prepare(s, { sender: 'chatgpt', recipient: 'gemini', text: 'safe' });
  assert.throws(() => validateEnvelope({ ...e, dangerous: true }), /fields/);
  let last = e;
  for (let turn = 2; turn <= 12; turn++) {
    approve(s, last.message_id, 'arisnachy'); markDelivered(s, last.message_id, 'arisnachy');
    last = prepare(s, { sender: last.recipient, recipient: last.sender, text: `turn ${turn}`, replyTo: last.message_id });
  }
  approve(s, last.message_id, 'arisnachy'); markDelivered(s, last.message_id, 'arisnachy');
  assert.throws(() => prepare(s, { sender: last.recipient, recipient: last.sender, text: '13', replyTo: last.message_id }), /Turn out of range/);
});
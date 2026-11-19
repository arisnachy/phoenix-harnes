import { createHash, randomUUID } from 'node:crypto';

export const MAX_TURNS = 12;
export const MAX_TEXT = 12_000;
const AGENTS = new Set(['chatgpt', 'gemini', 'arisnachy']);
const INTENTS = new Set(['proposal', 'code_review', 'research', 'verdict', 'general']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const FIELDS = new Set(['protocol', 'version', 'message_id', 'thread_id', 'turn', 'sender', 'recipient', 'intent', 'payload', 'created_at', 'origin', 'reply_to']);

function check(ok, reason) { if (!ok) throw new Error(reason); }
function hasExactKeys(value, allowed) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).every((key) => allowed.has(key))
    && [...allowed].every((key) => Object.hasOwn(value, key));
}

export function validateEnvelope(msg) {
  check(hasExactKeys(msg, FIELDS), 'Envelope fields invalid');
  check(msg.protocol === 'phoenix-auth-bridge' && msg.version === 1, 'Protocol/version invalid');
  check(UUID.test(msg.message_id) && UUID.test(msg.thread_id), 'Invalid UUID');
  check(Number.isInteger(msg.turn) && msg.turn >= 1 && msg.turn <= MAX_TURNS, 'Turn out of range');
  check(AGENTS.has(msg.sender) && AGENTS.has(msg.recipient) && msg.sender !== msg.recipient, 'Sender/recipient invalid');
  check(INTENTS.has(msg.intent), 'Intent invalid');
  check(hasExactKeys(msg.payload, new Set(['text'])) && typeof msg.payload.text === 'string'
    && msg.payload.text.trim().length > 0 && msg.payload.text.length <= MAX_TEXT, 'Payload invalid');
  check(typeof msg.created_at === 'string' && ISO.test(msg.created_at)
    && !Number.isNaN(Date.parse(msg.created_at)), 'Timestamp invalid');
  check(['manual-user-entry', 'mcp-agent-proposal'].includes(msg.origin), 'Origin must be manual-user-entry or mcp-agent-proposal');
  check(msg.reply_to === null || (typeof msg.reply_to === 'string' && UUID.test(msg.reply_to)), 'Reply reference invalid');
  check((msg.turn === 1) === (msg.reply_to === null), 'First turn must not have a reply; later turns must');
  return true;
}

export function emptyState() { return { version: 1, paused: true, messages: [], audit: [] }; }

export function validateState(state) {
  check(state && state.version === 1 && typeof state.paused === 'boolean'
    && Array.isArray(state.messages) && Array.isArray(state.audit), 'Store corrupted');
  for (const row of state.messages) {
    validateEnvelope(row.envelope);
    check(['pending', 'approved', 'delivered', 'rejected'].includes(row.status), 'Invalid message status');
  }
  return true;
}

function event(state, action, messageId = null) {
  state.audit.push({ time: new Date().toISOString(), action, message_id: messageId });
  // Metadata only: deliberately no message bodies, credentials, or browser tokens.
}

function find(state, id) {
  const found = state.messages.find((row) => row.envelope.message_id === id);
  check(found, 'Unknown message');
  return found;
}

export function resume(state, actor) {
  validateState(state);
  check(actor === 'arisnachy', 'Explicit local user action required');
  state.paused = false;
  event(state, 'resume');
}

export function stop(state, actor) {
  validateState(state);
  check(actor === 'arisnachy', 'Explicit local user action required');
  state.paused = true;
  for (const row of state.messages) if (row.status === 'approved') {
    row.status = 'pending';
    event(state, 'approval_revoked_by_stop', row.envelope.message_id);
  }
  event(state, 'stop');
}

export function prepare(state, { sender, recipient, intent = 'general', text, replyTo = null }) {
  validateState(state);
  check(!state.paused, 'Bridge is STOPPED');
  let turn = 1; let threadId = randomUUID();
  if (replyTo !== null) {
    const previous = find(state, replyTo);
    check(previous.status === 'delivered', 'Previous turn must be manually marked delivered');
    check(previous.envelope.recipient === sender, 'Reply sender must match prior recipient');
    check(previous.envelope.sender === recipient, 'Reply recipient must match prior sender');
    turn = previous.envelope.turn + 1;
    threadId = previous.envelope.thread_id;
    check(!state.messages.some((r) => r.envelope.reply_to === replyTo), 'Reply already exists');
  }
  const envelope = {
    protocol: 'phoenix-auth-bridge', version: 1, message_id: randomUUID(), thread_id: threadId,
    turn, sender, recipient, intent, payload: { text }, created_at: new Date().toISOString(),
    origin: 'manual-user-entry', reply_to: replyTo,
  };
  validateEnvelope(envelope);
  state.messages.push({ envelope, status: 'pending' });
  event(state, 'prepared', envelope.message_id);
  return envelope;
}

export function approve(state, id, actor) {
  validateState(state);
  check(!state.paused, 'Bridge is STOPPED');
  check(actor === 'arisnachy', 'Explicit local user approval required');
  const row = find(state, id);
  check(row.status === 'pending', 'Message not pending');
  row.status = 'approved';
  event(state, 'approved', id);
}

export function relayText(state, id) {
  validateState(state);
  check(!state.paused, 'Bridge is STOPPED');
  const row = find(state, id);
  check(row.status === 'approved', 'Message must be approved first');
  const m = row.envelope;
  // This function returns text to the local user's terminal, not to a web service.
  return `[PHOENIX AUTH BRIDGE · manual relay]\nFrom (user-labeled): ${m.sender}\nTo: ${m.recipient}\nThread: ${m.thread_id}\nTurn: ${m.turn}/${MAX_TURNS}\nIntent: ${m.intent}\n\n${m.payload.text}`;
}

export function markDelivered(state, id, actor) {
  validateState(state);
  check(!state.paused, 'Bridge is STOPPED');
  check(actor === 'arisnachy', 'Explicit local user action required');
  const row = find(state, id);
  check(row.status === 'approved', 'Message not approved');
  row.status = 'delivered';
  event(state, 'user_marked_delivered', id);
}

export function reject(state, id, actor) {
  validateState(state);
  check(actor === 'arisnachy', 'Explicit local user action required');
  const row = find(state, id);
  check(['pending', 'approved'].includes(row.status), 'Cannot reject delivered message');
  row.status = 'rejected';
  event(state, 'rejected', id);
}

export function metadata(state) {
  validateState(state);
  return {
    paused: state.paused,
    messages: state.messages.map(({ envelope: m, status }) => ({ id: m.message_id,
      thread_id: m.thread_id, turn: m.turn, from: m.sender, to: m.recipient,
      intent: m.intent, status, text_sha256: createHash('sha256').update(m.payload.text).digest('hex') })),
    audit: state.audit,
  };
}

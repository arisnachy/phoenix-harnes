#!/usr/bin/env node
/**
 * Public release HEAD scan. No secrets are printed. A pass does NOT prove that
 * git history, CI artifacts, installed profiles, release ZIPs or unknown token
 * formats are safe. Credential rotation is mandatory for any genuine leak.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

const files = execFileSync('git', ['ls-files', '-z'], {
  encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
}).split('\0').filter(Boolean);
const rules = [
  ['OpenAI-like key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{40,}\b/g],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{35,}\b/g],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{35,}\b/g],
  ['Private key material', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
];
const forbiddenState = /(?:^|\/)(?:\.env(?:\.(?!example$|sample$|template$)[^/]+)?|id_rsa|id_ed25519|state\.db(?:-(?:wal|shm))?|state_snapshot\.json)$/i;
const findings = [];
let scanned = 0, binaryOrLarge = 0;
for (const file of files) {
  if (forbiddenState.test(file)) {
    findings.push({ rule: 'Tracked private runtime/config', file });
  }
  let buf;
  try {
    const stat = statSync(file);
    if (!stat.isFile() || stat.size > 4 * 1024 * 1024) { binaryOrLarge++; continue; }
    buf = readFileSync(file);
  } catch { binaryOrLarge++; continue; }
  if (buf.includes(0)) { binaryOrLarge++; continue; }
  const body = buf.toString('utf8');
  scanned++;
  for (const [rule, pattern] of rules) {
    pattern.lastIndex = 0;
    const m = pattern.exec(body);
    if (m) {
      const line = body.slice(0, m.index).split('\n').length;
      findings.push({ rule, file, line });
    }
  }
}
console.log(JSON.stringify({
  type: 'phoenix-public-release-audit', scannedTextFiles: scanned,
  skippedBinaryOrLarge: binaryOrLarge, totalTracked: files.length,
  findings: findings.slice(0, 50), findingsCount: findings.length,
}, null, 2));
if (findings.length) {
  console.error('SECURITY GATE FAILED: review matching paths without printing secret values; rotate exposed keys.');
  process.exitCode = 1;
}

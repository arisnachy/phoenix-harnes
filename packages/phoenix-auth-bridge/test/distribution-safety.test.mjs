import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const html = read('../../../apps/web/public/phoenix-team.html');
const schemaText = read('../schema/phoenix-envelope.schema.json');
const guardText = read('../src/guard.mjs');
const installerText = read('../setup-team.ps1');
const settingsText = read('../gemini_bridge/configure_gemini_cli.py');

test('public distribution has a neutral default user and portable schema', () => {
  const schema = JSON.parse(schemaText);
  assert.deepEqual(schema.properties.sender.enum, ['chatgpt', 'gemini', 'user']);
  assert.deepEqual(schema.properties.recipient.enum, ['chatgpt', 'gemini', 'user']);
  assert.equal(schema.$id, 'urn:phoenix:auth-bridge:envelope:v1');
  assert.match(html, /<option value="user">Usuario/);
  assert.match(guardText, /new Set\(\['chatgpt', 'gemini', 'user'\]\)/);
  assert.match(guardText, /actor === 'local-operator'/);
});

test('bridge does not ship embedded credentials or fixed Windows profiles', () => {
  for (const source of [html, schemaText, guardText, installerText, settingsText]) {
    assert.doesNotMatch(source, /C:\\Users\\[^\\]+/i);
    assert.doesNotMatch(source, /sk-[a-z0-9_-]{24,}/i);
    assert.doesNotMatch(source, /gh[pousr]_[a-z0-9]{30,}/i);
    assert.doesNotMatch(source, /AIza[0-9A-Za-z_-]{35}/);
    assert.doesNotMatch(source, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/);
  }
  assert.match(settingsText, /Path\.home\(\)/);
  assert.match(installerText, /if \(-not \$Apply\)/);
});

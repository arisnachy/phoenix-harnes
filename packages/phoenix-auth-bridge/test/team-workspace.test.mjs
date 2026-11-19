import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const page = readFileSync(new URL('../../../apps/web/public/phoenix-team.html', import.meta.url), 'utf8');
const installer = readFileSync(new URL('../setup-team.ps1', import.meta.url), 'utf8');
test('team workspace never impersonates an authenticated model', () => {
  assert.match(page, /supervisado/);
  assert.match(page, /No es un modelo nuevo/);
  assert.match(page, /No se ha enviado/);
  assert.doesNotMatch(page, /fetch\\s*\\(/);
  assert.doesNotMatch(page, /localStorage/);
  assert.doesNotMatch(page, /XMLHttpRequest/);
  assert.doesNotMatch(page, /<script[^>]+src=/);
});
test('installer defaults to preview and gates external installs', () => {
  assert.match(installer, /if \\(-not \\$Apply\\)/);
  assert.match(installer, /if \\(\\$InstallClients\\)/);
  assert.match(installer, /if \\(\\$RegisterGemini\\)/);
  assert.doesNotMatch(installer, /-ExecutionPolicy Bypass/);
});

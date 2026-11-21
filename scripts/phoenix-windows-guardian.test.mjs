import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { decideGuardianAction } from './phoenix-windows-guardian.mjs'

test('existing PHOENIX supervisor is never restarted or killed by guardian',()=>{
  assert.equal(decideGuardianAction({observed:'phoenix-supervisor',recentRestarts:0}),'healthy')
  assert.equal(decideGuardianAction({observed:'phoenix-supervisor',recentRestarts:9}),'healthy')
})
test('uncertain process identity fails closed without starting a duplicate',()=>{
  assert.equal(decideGuardianAction({observed:'unknown'}),'hold')
})
test('missing supervisor launches only within restart budget',()=>{
  assert.equal(decideGuardianAction({observed:'absent',recentRestarts:0}),'start')
  assert.equal(decideGuardianAction({observed:'other-process',recentRestarts:3}),'start')
  assert.equal(decideGuardianAction({observed:'absent',recentRestarts:4}),'backoff')
})
test('guardian requires deliberate task installation, never runs in production implicitly',()=>{
  const source=readFileSync(new URL('./phoenix-windows-guardian.mjs',import.meta.url),'utf8')
  const task=readFileSync(new URL('./phoenix-windows-guardian-task.ps1',import.meta.url),'utf8')
  assert.match(source,/Get-CimInstance/)
  assert.match(source,/processIdentity/)
  assert.doesNotMatch(source,/taskkill|Stop-Process|kill\(/iu)
  assert.match(task,/\$Install/)
  assert.match(task,/\$Uninstall/)
  assert.match(task,/Register-ScheduledTask/)
  assert.match(task,/Unregister-ScheduledTask/)
})

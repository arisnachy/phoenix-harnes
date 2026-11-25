import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  flaUiChildEnvironment,
  locateFlaUiExecutable,
} from './phoenix-windows-flaui-mcp.mjs'

test('FlaUI launcher refuses other operating systems and missing Windows user data', () => {
  assert.throws(() => locateFlaUiExecutable({ platform: 'linux', localAppData: 'C:\\Temp' }),
    /WINDOWS_FLAUI_REQUIRES_WINDOWS/)
  assert.throws(() => locateFlaUiExecutable({ platform: 'win32', localAppData: '' }),
    /WINDOWS_FLAUI_LOCALAPPDATA_MISSING/)
})

test('FlaUI launcher cannot inherit provider API keys or PHOENIX secrets', () => {
  const environment = flaUiChildEnvironment({
    SYSTEMROOT: 'C:\\Windows',
    LOCALAPPDATA: 'C:\\Users\\Test\\AppData\\Local',
    PATH: 'C:\\Windows\\System32',
    PHOENIX_FABRIC_ADMIN_TOKEN: 'not-for-child',
    OPENAI_API_KEY: 'not-for-child',
    AZURE_CLIENT_SECRET: 'not-for-child',
  })
  assert.deepEqual(environment, {
    SYSTEMROOT: 'C:\\Windows',
    PATH: 'C:\\Windows\\System32',
    LOCALAPPDATA: 'C:\\Users\\Test\\AppData\\Local',
  })
  assert.equal(Object.hasOwn(environment, 'OPENAI_API_KEY'), false)
})

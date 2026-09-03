import { describe, expect, it } from 'vitest'
import {
  codexExecutableOverride,
  supplementalExecutableDirectories,
  windowsCodexDesktopExecutableDirectories,
} from '../src/index.ts'

describe('Windows user CLI discovery', () => {
  it('adds npm and pnpm user homes even when they are absent from PATH', () => {
    expect(supplementalExecutableDirectories({
      APPDATA: 'C:\\Users\\arisn\\AppData\\Roaming',
      LOCALAPPDATA: 'C:\\Users\\arisn\\AppData\\Local',
      PNPM_HOME: 'C:\\Users\\arisn\\AppData\\Local\\pnpm-custom',
    }, 'win32')).toEqual([
      'C:\\Users\\arisn\\AppData\\Local\\pnpm-custom',
      'C:\\Users\\arisn\\AppData\\Roaming\\npm',
      'C:\\Users\\arisn\\AppData\\Local\\pnpm',
    ])
  })

  it('uses Windows case-insensitive environment-key semantics and removes duplicates', () => {
    expect(supplementalExecutableDirectories({
      appdata: 'C:\\Users\\arisn\\AppData\\Roaming',
      localappdata: 'C:\\Users\\arisn\\AppData\\Local',
      pnpm_home: 'C:\\Users\\arisn\\AppData\\Local\\pnpm',
    }, 'win32')).toEqual([
      'C:\\Users\\arisn\\AppData\\Local\\pnpm',
      'C:\\Users\\arisn\\AppData\\Roaming\\npm',
    ])
  })

  it('prefers the explicit Codex Desktop CLI path when the app exposes one', () => {
    expect(codexExecutableOverride({
      codex_cli_path: ' C:\\Users\\arisn\\AppData\\Local\\OpenAI\\Codex\\bin\\abc123\\codex.exe ',
    }, 'win32')).toBe('C:\\Users\\arisn\\AppData\\Local\\OpenAI\\Codex\\bin\\abc123\\codex.exe')
  })

  it('discovers hashed Codex Desktop bin directories under LOCALAPPDATA', () => {
    expect(windowsCodexDesktopExecutableDirectories({
      LOCALAPPDATA: 'C:\\Users\\arisn\\AppData\\Local',
    }, ['abc123', 'def456'], 'win32')).toEqual([
      'C:\\Users\\arisn\\AppData\\Local\\OpenAI\\Codex\\bin',
      'C:\\Users\\arisn\\AppData\\Local\\OpenAI\\Codex\\bin\\abc123',
      'C:\\Users\\arisn\\AppData\\Local\\OpenAI\\Codex\\bin\\def456',
    ])
  })

  it('does not add Windows package-manager or Codex Desktop directories on other platforms', () => {
    expect(supplementalExecutableDirectories({
      APPDATA: '/tmp/roaming',
      LOCALAPPDATA: '/tmp/local',
      PNPM_HOME: '/tmp/pnpm',
    }, 'linux')).toEqual([])
    expect(windowsCodexDesktopExecutableDirectories({
      LOCALAPPDATA: '/tmp/local',
    }, ['abc123'], 'linux')).toEqual([])
  })
})
import { describe, expect, it } from 'vitest'
import { supplementalExecutableDirectories } from '../src/index.ts'

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

  it('does not add Windows package-manager directories on other platforms', () => {
    expect(supplementalExecutableDirectories({
      APPDATA: '/tmp/roaming',
      LOCALAPPDATA: '/tmp/local',
      PNPM_HOME: '/tmp/pnpm',
    }, 'linux')).toEqual([])
  })
})

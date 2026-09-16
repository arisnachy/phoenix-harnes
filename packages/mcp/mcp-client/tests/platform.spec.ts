import { describe, expect, it } from 'vitest'
import {
  checkPlatformCompatibility,
  resolveSupportedPlatforms,
} from '@phoenix-ai/dsh-mcp-client/src/platform.ts'

describe('MCP stdio platform compatibility', () => {
  it('blocks persisted XcodeBuildMCP configs on Windows before spawn', () => {
    const compatibility = checkPlatformCompatibility({
      serverName: 'XcodeBuildMCP',
      command: 'npx',
      args: ['-y', 'xcodebuildmcp@latest'],
    }, 'win32')

    expect(compatibility).toEqual({
      compatible: false,
      platform: 'win32',
      supportedPlatforms: ['darwin'],
    })
  })

  it('recognizes XcodeBuildMCP from command arguments when the server alias is custom', () => {
    expect(resolveSupportedPlatforms({
      serverName: 'ios-tools',
      command: 'npx',
      args: ['-y', 'xcodebuildmcp@latest'],
    })).toEqual(['darwin'])
  })

  it('allows XcodeBuildMCP on macOS', () => {
    expect(checkPlatformCompatibility({
      serverName: 'XcodeBuildMCP',
      command: 'npx',
      args: ['-y', 'xcodebuildmcp@latest'],
    }, 'darwin').compatible).toBe(true)
  })

  it('keeps unknown stdio MCP servers cross-platform by default', () => {
    expect(checkPlatformCompatibility({
      serverName: 'google-workspace',
      command: 'npx',
      args: ['-y', '@example/google-workspace-mcp'],
    }, 'win32')).toEqual({ compatible: true, platform: 'win32' })
  })

  it('honors explicit platform metadata for future platform-bound MCP servers', () => {
    expect(checkPlatformCompatibility({
      serverName: 'linux-only',
      command: 'node',
      supportedPlatforms: ['linux'],
    }, 'win32')).toEqual({
      compatible: false,
      platform: 'win32',
      supportedPlatforms: ['linux'],
    })
  })

  it('fails loud on invalid explicit platform metadata', () => {
    expect(() => resolveSupportedPlatforms({
      serverName: 'bad-platform',
      command: 'node',
      supportedPlatforms: ['windows'],
    })).toThrow('unsupported platform value "windows"')
  })
})

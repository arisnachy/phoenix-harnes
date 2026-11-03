import { describe, expect, it } from 'vitest'
import {
  checkPlatformCompatibility,
  resolveSupportedPlatforms,
} from '@phoenix-ai/dsh-mcp-client/src/platform.ts'
import { normalizeWindowsNpxMcpLaunch } from '@phoenix-ai/dsh-mcp-client/src/transport.ts'

describe('MCP stdio platform compatibility', () => {
  it('wraps the official Memory MCP NPX launcher with cmd on Windows', () => {
    expect(normalizeWindowsNpxMcpLaunch(
      'npx',
      ['-y', '@modelcontextprotocol/server-memory'],
      'win32',
    )).toEqual({
      command: 'cmd.exe',
      args: ['/d', '/c', 'npx', '-y', '@modelcontextprotocol/server-memory'],
    })
  })

  it('starts curated Filesystem MCP using a bundled entrypoint or an explicit NPX fallback', () => {
    const officialPackage = '@modelcontextprotocol/server-filesystem'
    const result = normalizeWindowsNpxMcpLaunch(
      'npx',
      ['-y', officialPackage, '.'],
      'win32',
    )
    if (result.command === process.execPath) {
      expect(result.args[0]?.replace(/\\/gu, '/')).toContain('/dist/index.js')
      expect(result.args.slice(1)).toEqual(['.'])
    } else {
      expect(result).toEqual({
        command: 'cmd.exe',
        args: ['/d', '/c', 'npx', '-y', officialPackage, '.'],
      })
    }
  })

  it('never retries a bare missing Filesystem Windows shim', () => {
    const result = normalizeWindowsNpxMcpLaunch(
      'mcp-server-filesystem',
      ['C:\\\\Users\\\\example\\\\Documents'],
      'win32',
    )
    expect(result.command).not.toBe('mcp-server-filesystem')
    if (result.command === process.execPath) {
      expect(result.args[0]?.replace(/\\/gu, '/')).toContain('/dist/index.js')
    } else {
      expect(result).toEqual({
        command: 'cmd.exe',
        args: ['/d', '/c', 'npx', '-y', '@modelcontextprotocol/server-filesystem',
          'C:\\\\Users\\\\example\\\\Documents'],
      })
    }
  })

  it('launches only the pinned official X bridge via cmd.exe on Windows', () => {
    expect(normalizeWindowsNpxMcpLaunch(
      'npx', ['-y', '@xdevplatform/xurl', 'mcp', 'https://api.x.com/mcp'], 'win32',
    )).toEqual({
      command: 'cmd.exe',
      args: ['/d', '/c', 'npx', '-y', '@xdevplatform/xurl', 'mcp', 'https://api.x.com/mcp'],
    })
    expect(normalizeWindowsNpxMcpLaunch(
      'npx', ['-y', '@xdevplatform/xurl', 'mcp', '-u', 'PhoenixAI', 'https://api.x.com/mcp'], 'win32',
    )).toEqual({
      command: 'cmd.exe',
      args: ['/d', '/c', 'npx', '-y', '@xdevplatform/xurl', 'mcp', '-u', 'PhoenixAI', 'https://api.x.com/mcp'],
    })
    for (const args of [
      ['-y', '@xdevplatform/xurl', 'mcp', 'https://attacker.example/mcp'],
      ['-y', '@xdevplatform/xurl', 'mcp', '-u', 'x&whoami', 'https://api.x.com/mcp'],
      ['-y', '@xdevplatform/xurl', 'mcp', 'https://api.x.com/mcp', '&whoami'],
    ]) {
      expect(normalizeWindowsNpxMcpLaunch('npx', args, 'win32').command).toBe('npx')
    }
  })

  it('does not introduce a shell for arbitrary registry NPX packages', () => {
    expect(normalizeWindowsNpxMcpLaunch(
      'npx',
      ['-y', '@example/untrusted-mcp', 'a&whoami'],
      'win32',
    )).toEqual({
      command: 'npx',
      args: ['-y', '@example/untrusted-mcp', 'a&whoami'],
    })
  })

  it('keeps curated NPX launchers unchanged off Windows', () => {
    expect(normalizeWindowsNpxMcpLaunch(
      'npx',
      ['-y', '@modelcontextprotocol/server-memory'],
      'linux',
    )).toEqual({
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-memory'],
    })
  })

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

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { CodexModelListTransport } from '../src/codex-discovery.ts'
import {
  codexDiscoveryArgs,
  codexDiscoveryCommand,
  encodeCodexWireFrame,
  readCodexModelPage,
} from '../src/codex-discovery.ts'
import { discoverModels } from '../src/discovery.ts'

describe('openai-codex live model discovery', () => {
  it('uses the live Codex catalog instead of the bundled pi-ai catalog', async () => {
    const list = vi.fn(async () => [
      { id: 'chatgpt-remote-only', name: 'ChatGPT Remote Only' },
      { id: 'gpt-6-astra', name: 'Astra' },
    ])
    const transport: CodexModelListTransport = { list }
    const storedApiKey = vi.fn(async () => {
      throw new Error('Codex discovery must not resolve an API key')
    })

    const models = await discoverModels(
      { provider: 'openai-codex' },
      storedApiKey,
      transport,
    )

    expect(models).toEqual([
      { id: 'chatgpt-remote-only', name: 'ChatGPT Remote Only' },
      { id: 'gpt-6-astra', name: 'Astra' },
    ])
    expect(list).toHaveBeenCalledOnce()
    expect(storedApiKey).not.toHaveBeenCalled()
  })

  it('fails loud when live Codex discovery fails instead of returning a stale static list', async () => {
    const transport: CodexModelListTransport = {
      list: vi.fn(async () => { throw new Error('live catalog unavailable') }),
    }

    await expect(discoverModels({ provider: 'openai-codex' }, undefined, transport))
      .rejects.toThrow('live catalog unavailable')
  })

  it('forwards cancellation to the live Codex transport', async () => {
    const controller = new AbortController()
    const list = vi.fn(async () => [])

    await discoverModels({ provider: 'openai-codex', signal: controller.signal }, undefined, { list })

    expect(list).toHaveBeenCalledWith(controller.signal)
  })
})

describe('Codex app-server wire protocol', () => {
  it('keeps metadata probes away from plugin and bundled-skill installation', () => {
    expect(codexDiscoveryArgs()).toEqual([
      '-c',
      'features.plugins=false',
      '-c',
      'skills.bundled.enabled=false',
      'app-server',
      '--listen',
      'stdio://',
    ])
  })

  it('prefers the Phoenix-managed Codex runtime for model discovery', () => {
    const root = mkdtempSync(join(tmpdir(), 'phoenix-codex-discovery-'))
    const packageRoot = join(root, 'node_modules', '@openai', 'codex')
    const bin = join(packageRoot, 'bin', 'codex.js')
    mkdirSync(join(packageRoot, 'bin'), { recursive: true })
    writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({
      name: '@openai/codex',
      version: '9.9.9',
      bin: { codex: 'bin/codex.js' },
    }))
    writeFileSync(bin, '')
    const previous = process.env.PHOENIX_CODEX_RUNTIME_ROOT
    try {
      process.env.PHOENIX_CODEX_RUNTIME_ROOT = root
      expect(codexDiscoveryCommand()).toEqual({
        source: 'managed',
        command: process.execPath,
        args: [bin, ...codexDiscoveryArgs()],
      })
    } finally {
      if (previous === undefined) delete process.env.PHOENIX_CODEX_RUNTIME_ROOT
      else process.env.PHOENIX_CODEX_RUNTIME_ROOT = previous
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('falls back to the PATH Codex command when the managed runtime is invalid', () => {
    const root = mkdtempSync(join(tmpdir(), 'phoenix-codex-discovery-invalid-'))
    const previous = process.env.PHOENIX_CODEX_RUNTIME_ROOT
    try {
      process.env.PHOENIX_CODEX_RUNTIME_ROOT = root
      expect(codexDiscoveryCommand('linux')).toEqual({
        source: 'path',
        command: 'codex',
        args: codexDiscoveryArgs(),
      })
      expect(codexDiscoveryCommand('win32')).toEqual({
        source: 'path',
        command: process.env.ComSpec ?? 'cmd.exe',
        args: ['/d', '/s', '/c', `codex ${codexDiscoveryArgs().join(' ')}`],
      })
    } finally {
      if (previous === undefined) delete process.env.PHOENIX_CODEX_RUNTIME_ROOT
      else process.env.PHOENIX_CODEX_RUNTIME_ROOT = previous
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('writes JSONL requests without the jsonrpc member Codex omits on its wire', () => {
    const frame = encodeCodexWireFrame({
      id: 2,
      method: 'model/list',
      params: { cursor: null, limit: 100, includeHidden: false },
    })

    expect(frame.endsWith('\n')).toBe(true)
    expect(JSON.parse(frame)).toEqual({
      id: 2,
      method: 'model/list',
      params: { cursor: null, limit: 100, includeHidden: false },
    })
    expect(frame).not.toContain('jsonrpc')
    expect(() => encodeCodexWireFrame({ jsonrpc: '2.0', method: 'initialized' }))
      .toThrow(/must omit the jsonrpc member/)
  })
})

describe('Codex app-server model/list mapping', () => {
  it('uses the turn model value, keeps display names, skips hidden rows, and preserves pagination', () => {
    expect(readCodexModelPage({
      data: [
        { id: 'catalog-id', model: 'actual-turn-model', displayName: 'Actual model', hidden: false },
        { id: 'fallback-id', displayName: 'Legacy shape', hidden: false },
        { id: 'hidden-id', model: 'hidden-model', displayName: 'Hidden', hidden: true },
        { displayName: 'missing id' },
      ],
      nextCursor: 'cursor-2',
    })).toEqual({
      models: [
        { id: 'actual-turn-model', name: 'Actual model' },
        { id: 'fallback-id', name: 'Legacy shape' },
      ],
      nextCursor: 'cursor-2',
    })
  })

  it('preserves Codex reasoning capabilities for newly advertised models', () => {
    expect(readCodexModelPage({
      data: [{
        id: 'gpt-6-astra',
        model: 'gpt-6-astra',
        displayName: 'GPT-6-Astra',
        hidden: false,
        supportedReasoningEfforts: [
          { reasoningEffort: 'low', description: 'Fast responses with lighter reasoning' },
          { reasoningEffort: 'high', description: 'Greater reasoning depth for complex problems' },
          { reasoningEffort: 'max', description: 'Maximum reasoning depth for the hardest problems' },
          { reasoningEffort: 'ultra', description: 'Maximum reasoning with automatic task delegation' },
        ],
        defaultReasoningEffort: 'low',
      }],
    })).toEqual({
      models: [{
        id: 'gpt-6-astra',
        name: 'GPT-6-Astra',
        reasoning: {
          efforts: [
            { id: 'low', name: 'Low', description: 'Fast responses with lighter reasoning' },
            { id: 'high', name: 'High', description: 'Greater reasoning depth for complex problems' },
            { id: 'max', name: 'Max', description: 'Maximum reasoning depth for the hardest problems' },
            { id: 'ultra', name: 'Ultra', description: 'Maximum reasoning with automatic task delegation' },
          ],
          defaultEffort: 'low',
        },
      }],
    })
  })

  it('refuses a malformed app-server response rather than inventing models', () => {
    expect(() => readCodexModelPage({ models: [] })).toThrow(/no data array/)
  })
})

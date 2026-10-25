import { describe, expect, it } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import { createScope } from '@phoenix-ai/dsh-scope'
import type { Agent } from '@phoenix-ai/dsh-agent'
import { CallId } from '@phoenix-ai/dsh-llm'
import { CodeRuntime } from '@phoenix-ai/dsh-code-runtime'
import type { CodeRunRequest, CodeRunResult } from '@phoenix-ai/dsh-code-runtime'
import SystemPrompt from '@phoenix-ai/dsh-system-prompt'
import ToolRuntime, { type ToolDefinition } from '@phoenix-ai/dsh-tools'
import type { SessionId } from '@phoenix-ai/dsh-session'

const signal = new AbortController().signal

class TestCodeRuntime extends CodeRuntime {
  readonly language = 'typescript'
  readonly isolation = 'test'

  run(_request: CodeRunRequest): Promise<CodeRunResult> {
    return Promise.resolve({ logs: [] })
  }
}

function tool(name: string, description = name): ToolDefinition {
  return {
    name,
    description,
    parameters: { type: 'object', properties: {} },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value as string }],
    },
    execute: () => Promise.resolve(`ran:${name}`),
  }
}

async function mount(): Promise<{ ctx: Context; agent: Agent }> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime, { mcpToolLazyThreshold: 1 })
  const agent = { id: 'lazy-mcp' as SessionId } as Agent
  await ctx.plugin(Object.assign((inner: Context) => { createScope(inner, agent) }, {
    inject: ['tools', 'systemPrompt'],
  }))
  return { ctx, agent }
}

async function addAgent(ctx: Context, id: string): Promise<Agent> {
  const agent = { id: id as SessionId } as Agent
  await ctx.plugin(Object.assign((inner: Context) => { createScope(inner, agent) }, {
    inject: ['tools', 'systemPrompt'],
  }))
  return agent
}

async function mountCodeMode(): Promise<{ ctx: Context; agent: Agent }> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime, { mode: 'code', mcpToolLazyThreshold: 1 })
  await ctx.plugin(TestCodeRuntime)
  const agent = { id: 'lazy-mcp-code' as SessionId } as Agent
  await ctx.plugin(Object.assign((inner: Context) => { createScope(inner, agent) }, {
    inject: ['tools', 'systemPrompt'],
  }))
  return { ctx, agent }
}

describe('lazy MCP tool presentation', () => {
  it('projects native tools and a scoped discovery tool instead of a large MCP catalog', async () => {
    const { ctx, agent } = await mount()
    ctx.tools.register(tool('bash', 'native'))
    ctx.tools.register(tool('mcp__server__alpha', 'alpha MCP'))
    ctx.tools.register(tool('mcp__server__beta', 'beta MCP'))
    ctx.tools.register(tool('mcp__server__gamma', 'gamma MCP'))

    const fullChars = JSON.stringify(ctx.tools.schemas(agent)).length
    const assembly = await ctx.systemPrompt.assemble({ scope: agent })

    expect(assembly.tools.map(item => item.name)).toEqual(['bash', 'tool_search'])
    expect(JSON.stringify(assembly.tools).length).toBeLessThan(fullChars)
  })

  it('executes a discovered MCP tool after discovery', async () => {
    const { ctx, agent } = await mount()
    ctx.tools.register(tool('mcp__server__alpha', 'alpha MCP'))
    ctx.tools.register(tool('mcp__server__beta', 'beta MCP'))

    const hidden = await ctx.tools.execute({
      signal,
      callId: CallId('hidden'),
      name: 'mcp__server__alpha',
      agent,
      arguments: {},
    })
    expect(hidden).toMatchObject({ isError: true, error: { info: { code: 'UNKNOWN_TOOL' } } })

    const search = await ctx.tools.execute({
      signal,
      callId: CallId('search'),
      name: 'tool_search',
      agent,
      arguments: { query: 'alpha' },
    })
    expect(search.isError).toBe(false)
    expect(search.value).toMatchObject({ tools: [{ name: 'mcp__server__alpha' }] })

    const result = await ctx.tools.execute({
      signal,
      callId: CallId('call'),
      name: 'mcp__server__alpha',
      agent,
      arguments: {},
    })
    expect(result).toMatchObject({ isError: false, value: 'ran:mcp__server__alpha' })
  })

  it('returns compact discovery metadata without duplicating the complete MCP schema', async () => {
    const { ctx, agent } = await mount()
    const definition = tool('mcp__server__detailed', 'Detailed external capability')
    definition.parameters = {
      type: 'object',
      properties: { payload: { type: 'string', description: 'x'.repeat(12_000) } },
    }
    ctx.tools.register(definition)
    ctx.tools.register(tool('mcp__server__other', 'other MCP'))

    const complete = ctx.tools.schemas(agent).find(item => item.name === definition.name)
    expect(complete).toBeDefined()
    const discovery = await ctx.tools.execute({
      signal,
      callId: CallId('compact-search'),
      name: 'tool_search',
      agent,
      arguments: { names: [definition.name] },
    })
    expect(discovery).toMatchObject({
      isError: false,
      value: { selected: 1, tools: [{ name: definition.name, schemaDeferred: true }] },
    })
    const resultText = JSON.stringify(discovery.value)
    expect(resultText).not.toContain('x'.repeat(100))
    expect(resultText.length).toBeLessThan(JSON.stringify(complete).length / 20)

    // The schema is still complete in the immediately following model request
    // and its tool remains executable. This must not disable MCP functionality.
    const assembly = await ctx.systemPrompt.assemble({ scope: agent })
    const active = assembly.tools.find(item => item.name === definition.name)
    expect((active?.parameters.properties as Record<string, { description?: string }>).payload?.description)
      .toHaveLength(12_000)
    const executed = await ctx.tools.execute({
      signal,
      callId: CallId('compact-call'),
      name: definition.name,
      agent,
      arguments: { payload: 'test' },
    })
    expect(executed).toMatchObject({ isError: false, value: 'ran:mcp__server__detailed' })
  })

  it('keeps the unscoped registry and host execution complete for a large MCP catalog', async () => {
    const { ctx } = await mount()
    ctx.tools.register(tool('mcp__server__alpha', 'alpha MCP'))
    ctx.tools.register(tool('mcp__server__beta', 'beta MCP'))

    expect(ctx.tools.get('mcp__server__alpha')).toBeDefined()
    expect(ctx.tools.schemas().map(item => item.name)).toEqual([
      'mcp__server__alpha',
      'mcp__server__beta',
    ])
    const result = await ctx.tools.execute({
      signal,
      callId: CallId('unscoped'),
      name: 'mcp__server__alpha',
      arguments: {},
    })
    expect(result).toMatchObject({ isError: false, value: 'ran:mcp__server__alpha' })
  })

  it('matches multiword searches and keeps oversized result summaries bounded while activating the full schema', async () => {
    const { ctx, agent } = await mount()
    const definition = tool('mcp__github__create_issue', 'GitHub create issue')
    definition.parameters = {
      type: 'object',
      properties: { body: { type: 'string', description: 'x'.repeat(40_000) } },
    }
    ctx.tools.register(definition)
    ctx.tools.register(tool('mcp__server__ordinary', 'ordinary MCP'))

    const result = await ctx.tools.execute({
      signal,
      callId: CallId('large-search'),
      name: 'tool_search',
      agent,
      arguments: { query: 'github create issue' },
    })
    expect(result.isError).toBe(false)
    expect(JSON.stringify(result.value).length).toBeLessThanOrEqual(32_000)
    expect(result.value).toMatchObject({ selected: 1, tools: [{ name: 'mcp__github__create_issue', schemaDeferred: true }] })

    const assembly = await ctx.systemPrompt.assemble({ scope: agent })
    const discovered = assembly.tools.find(item => item.name === 'mcp__github__create_issue')
    expect((discovered?.parameters.properties as Record<string, { description?: string }>).body?.description)
      .toHaveLength(40_000)
  })

  it('bounds active discovered schema characters and permits one exact oversized schema', async () => {
    const { ctx, agent } = await mount()
    const largeNames = Array.from({ length: 3 }, (_, index) => `mcp__server__large-${index}`)
    for (const name of largeNames) {
      const definition = tool(name, 'large MCP')
      definition.parameters = {
        type: 'object',
        properties: { payload: { type: 'string', description: 'x'.repeat(30_000) } },
      }
      ctx.tools.register(definition)
    }

    const batch = await ctx.tools.execute({
      signal,
      callId: CallId('schema-budget-batch'),
      name: 'tool_search',
      agent,
      arguments: { query: 'large' },
    })
    expect(batch).toMatchObject({ isError: false, value: { matched: 3, selected: 2 } })
    expect(JSON.stringify(batch.value).length).toBeLessThanOrEqual(32_000)
    const bounded = await ctx.systemPrompt.assemble({ scope: agent })
    const activeBatch = bounded.tools.filter(item => item.name.startsWith('mcp__'))
    expect(activeBatch).toHaveLength(2)
    expect(JSON.stringify(activeBatch).length).toBeLessThanOrEqual(64_000)

    const hugeName = 'mcp__server__huge-exact'
    const huge = tool(hugeName, 'huge exact MCP')
    huge.parameters = {
      type: 'object',
      properties: { payload: { type: 'string', description: 'y'.repeat(70_000) } },
    }
    ctx.tools.register(huge)
    const described = await ctx.tools.execute({
      signal,
      callId: CallId('schema-budget-description'),
      name: 'tool_search',
      agent,
      arguments: { query: 'huge exact' },
    })
    expect(described).toMatchObject({
      isError: false,
      value: { matched: 1, selected: 1, tools: [{ name: hugeName, schemaDeferred: true }] },
    })
    expect(JSON.stringify(described.value).length).toBeLessThanOrEqual(32_000)
    const describedAssembly = await ctx.systemPrompt.assemble({ scope: agent })
    expect(describedAssembly.tools.filter(item => item.name.startsWith('mcp__'))).toHaveLength(1)
    const discovered = describedAssembly.tools.find(item => item.name === hugeName)
    expect((discovered?.parameters.properties as Record<string, { description?: string }>).payload?.description)
      .toHaveLength(70_000)

    const secondHugeName = 'mcp__server__huge-alternate'
    const secondHuge = tool(secondHugeName, 'huge exact alternate MCP')
    secondHuge.parameters = {
      type: 'object',
      properties: { payload: { type: 'string', description: 'z'.repeat(70_000) } },
    }
    ctx.tools.register(secondHuge)
    const broad = await ctx.tools.execute({
      signal,
      callId: CallId('schema-budget-broad'),
      name: 'tool_search',
      agent,
      arguments: { query: 'huge exact' },
    })
    expect(broad).toMatchObject({
      isError: false,
      value: {
        matched: 2,
        selected: 0,
        tools: [
          { name: hugeName, requiresExact: true },
          { name: secondHugeName, requiresExact: true },
        ],
      },
    })
    expect(JSON.stringify(broad.value).length).toBeLessThanOrEqual(32_000)

    const exact = await ctx.tools.execute({
      signal,
      callId: CallId('schema-budget-exact'),
      name: 'tool_search',
      agent,
      arguments: { names: [secondHugeName] },
    })
    expect(exact).toMatchObject({ isError: false, value: { matched: 1, selected: 1 } })
    const exactAssembly = await ctx.systemPrompt.assemble({ scope: agent })
    expect(exactAssembly.tools.filter(item => item.name.startsWith('mcp__'))).toHaveLength(1)
    expect(exactAssembly.tools.map(item => item.name)).toContain(secondHugeName)
  })

  it('bounds the per-agent discovered set so repeated searches do not rebuild a full catalog', async () => {
    const { ctx, agent } = await mount()
    const names = Array.from({ length: 65 }, (_, index) => `mcp__server__tool-${index}`)
    for (const name of names) ctx.tools.register(tool(name, `tool ${name}`))

    for (let offset = 0; offset < names.length; offset += 16) {
      await ctx.tools.execute({
        signal,
        callId: CallId(`batch-${offset}`),
        name: 'tool_search',
        agent,
        arguments: { names: names.slice(offset, offset + 16) },
      })
    }

    const assembly = await ctx.systemPrompt.assemble({ scope: agent })
    expect(assembly.tools.filter(item => item.name.startsWith('mcp__')).length).toBe(64)
    expect(assembly.tools.map(item => item.name)).toContain('mcp__server__tool-64')
    expect(assembly.tools.map(item => item.name)).not.toContain('mcp__server__tool-0')
  })

  it('keeps discovery isolated and applies the scope restriction to search results', async () => {
    const { ctx, agent } = await mount()
    const other = await addAgent(ctx, 'other')
    ctx.tools.register(tool('mcp__server__alpha', 'alpha MCP'))
    ctx.tools.register(tool('mcp__server__beta', 'beta MCP'))
    ctx.tools.register(tool('mcp__server__gamma', 'gamma MCP'))

    // The mask is enforced before discovery, so denied names are not leaked.
    const scope = { id: 'restricted' as SessionId } as Agent
    let restrictedCtx!: Context
    await ctx.plugin(Object.assign((inner: Context) => {
      restrictedCtx = createScope(inner, scope).ctx
      restrictedCtx.tools.restrict({ deny: ['mcp__server__beta'] })
    }, { inject: ['tools', 'systemPrompt'] }))

    await ctx.tools.execute({ signal, callId: CallId('a'), name: 'tool_search', agent, arguments: { query: 'alpha' } })
    const otherAssembly = await ctx.systemPrompt.assemble({ scope: other })
    expect(otherAssembly.tools.map(item => item.name)).toEqual(['tool_search'])

    // The restriction fixture is scoped independently; its search can only
    // select the allowed MCP definition when exercised by its own agent.
    const restrictedSearch = await ctx.tools.execute({
      signal,
      callId: CallId('restricted-search'),
      name: 'tool_search',
      agent: scope,
      arguments: { query: 'beta' },
    })
    expect(restrictedSearch).toMatchObject({ isError: false, value: { matched: 0, selected: 0, tools: [] } })
  })

  it('falls back to eager MCP presentation when a scope denies discovery', async () => {
    const { ctx } = await mount()
    ctx.tools.register(tool('mcp__server__alpha', 'alpha MCP'))
    ctx.tools.register(tool('mcp__server__beta', 'beta MCP'))
    const agent = { id: 'no-discovery' as SessionId } as Agent
    await ctx.plugin(Object.assign((inner: Context) => {
      const restrictedCtx = createScope(inner, agent).ctx
      restrictedCtx.tools.restrict({ deny: ['tool_search'] })
    }, { inject: ['tools', 'systemPrompt'] }))

    const assembly = await ctx.systemPrompt.assemble({ scope: agent })
    expect(assembly.tools.map(item => item.name)).toEqual([
      'mcp__server__alpha',
      'mcp__server__beta',
    ])
    const result = await ctx.tools.execute({
      signal,
      callId: CallId('eager-deny-search'),
      name: 'mcp__server__alpha',
      agent,
      arguments: {},
    })
    expect(result).toMatchObject({ isError: false, value: 'ran:mcp__server__alpha' })
  })

  it('keeps Code Mode bindings complete when the native MCP catalog would be deferred', async () => {
    const { ctx, agent } = await mountCodeMode()
    ctx.tools.register(tool('mcp__server__alpha', 'alpha MCP'))
    ctx.tools.register(tool('mcp__server__beta', 'beta MCP'))

    const assembly = await ctx.systemPrompt.assemble({ scope: agent })
    expect(assembly.tools.map(item => item.name)).toEqual(['run_code'])
    const sdk = assembly.sections.find(section => section.name === 'tools:sdk')?.text
    expect(sdk).toContain('mcp__server__alpha:')
    expect(sdk).toContain('mcp__server__beta:')
    expect(sdk).not.toContain('tool_search:')
  })
})

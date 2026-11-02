import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@phoenix-ai/cordis'
import Loader from '@phoenix-ai/cordis-plugin-loader'
import Include from '@phoenix-ai/cordis-plugin-include'
import AgentRegistry from '@phoenix-ai/dsh-agent'
import AgentLoop from '@phoenix-ai/dsh-agent-loop'
import LlmRuntime, { CallId, createUserMessage, LlmAdapter } from '@phoenix-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@phoenix-ai/dsh-llm'
import SessionStore, { SessionId } from '@phoenix-ai/dsh-session'
import SystemPrompt from '@phoenix-ai/dsh-system-prompt'
import ToolRuntime from '@phoenix-ai/dsh-tools'
import { describe, expect, it } from 'vitest'

/** External model stand-in; discovery, dispatch, and durable request assembly remain real. */
class DiscoveryAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const step = this.requests.push(options)
    if (step < 3) {
      const name = step === 1 ? 'tool_search' : 'mcp__github__create_issue'
      const args = step === 1 ? { names: ['mcp__github__create_issue'] } : { title: 'Token regression' }
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'block-end', index: 0, block: {
        type: 'tool-call', id: CallId(`discovery-${step}`), name, arguments: JSON.stringify(args),
      } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Created the issue.' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

describe('MCP discovery through a real Loader and agent loop', () => {
  it('reduces a 486-tool request and executes the discovered operation without bypassing dispatch', async () => {
    const root = await mkdtemp(join(tmpdir(), 'phoenix-mcp-discovery-'))
    const ctx = new Context()
    const executed: string[] = []
    const fixture = {
      name: 'discovery-catalog-fixture',
      inject: ['tools'],
      apply(inner: Context) {
        for (let index = 0; index < 486; index += 1) {
          const name = index === 0 ? 'mcp__github__create_issue' : `mcp__catalog__operation_${index}`
          inner.effect(() => inner.tools.register({
            name,
            description: `Connected tool ${index}. ` + 'Parameter documentation. '.repeat(60),
            parameters: { type: 'object', properties: { title: { type: 'string' } } },
            output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }] },
            execute() {
              executed.push(name)
              return Promise.resolve('created:Token regression')
            },
          }))
        }
        inner.effect(() => inner.tools.register({
          name: 'native_probe', description: 'Native operation remains directly available.',
          parameters: { type: 'object', properties: {} },
          output: { schema: { type: 'string' }, render: () => [{ type: 'text', text: 'native' }] },
          execute: () => Promise.resolve('native'),
        }))
      },
    }
    try {
      const configPath = join(root, 'cordis.yml')
      await writeFile(configPath, [
        "- name: '@phoenix-ai/dsh-llm'",
        "- name: '@phoenix-ai/dsh-session'",
        "- name: '@phoenix-ai/dsh-system-prompt'",
        "- name: '@phoenix-ai/dsh-tools'",
        "- name: '@phoenix-ai/dsh-agent'",
        "- name: '@phoenix-ai/dsh-agent-loop'",
        '  config:',
        '    agents: []',
        '- name: discovery-catalog-fixture',
        '',
      ].join('\n'))
      ctx.baseUrl = pathToFileURL(root).href + '/'
      await ctx.plugin(Loader)
      ctx.loader.builtins.include = Include
      const modules = new Map<string, unknown>([
        ['@phoenix-ai/dsh-llm', LlmRuntime], ['@phoenix-ai/dsh-session', SessionStore],
        ['@phoenix-ai/dsh-system-prompt', SystemPrompt], ['@phoenix-ai/dsh-tools', ToolRuntime],
        ['@phoenix-ai/dsh-agent', AgentRegistry], ['@phoenix-ai/dsh-agent-loop', AgentLoop],
        ['discovery-catalog-fixture', fixture],
      ])
      ctx.loader.internal = {
        version: 'v2',
        async import(specifier: string) {
          if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
          return modules.get(specifier)
        },
      } as unknown as NonNullable<typeof ctx.loader.internal>
      await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
      await ctx.loader.await()
      expect([...ctx.loader.entries()].filter(entry => entry.fiber === undefined && !entry.disabled)).toEqual([])
      const adapter = new DiscoveryAdapter()
      ctx.llm.registerAdapter(['fixture'], adapter)
      const { agent } = await ctx.agentLoop.createAgent(ctx, {
        sessionId: SessionId('discovery-loader'), agentOptions: { provider: 'fixture', model: 'fixture' },
      })
      const completeCatalogChars = JSON.stringify(ctx.tools.schemas(agent).filter(tool => tool.name.startsWith('mcp__'))
        .map(({ name, description, parameters }) => ({ name, description, parameters }))).length
      agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Create the GitHub issue.' }], source: { kind: 'user' } }))
      await agent.whenIdle()
      const first = adapter.requests[0]?.tools ?? []
      const discovered = adapter.requests[1]?.tools ?? []
      expect(adapter.requests).toHaveLength(3)
      expect(JSON.stringify(first).length).toBeLessThan(completeCatalogChars / 20)
      expect(agent.session.events.filter(event => event.type === 'tool/result').map(event => event.data.message.content[0].isError)).toEqual([false, false])
      expect({
        firstMcpSchemas: first.filter(tool => tool.name.startsWith('mcp__')).length,
        discoveredMcpSchemas: discovered.filter(tool => tool.name.startsWith('mcp__')).length,
        nativePreserved: first.some(tool => tool.name === 'native_probe'),
        executed,
        toolCalls: agent.session.events.filter(event => event.type === 'tool/call').map(event => event.data.name),
        completed: agent.session.events.findLast(event => event.type === 'turn/end')?.data.reason.kind === 'completed',
      }).toMatchInlineSnapshot(`
        {
          "completed": true,
          "discoveredMcpSchemas": 1,
          "executed": [
            "mcp__github__create_issue",
          ],
          "firstMcpSchemas": 0,
          "nativePreserved": true,
          "toolCalls": [
            "tool_search",
            "mcp__github__create_issue",
          ],
        }
      `)
    } finally {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
})

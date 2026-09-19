import { describe, expect, it } from 'vitest'
import type { GenerateOptions } from '@phoenix-ai/dsh-llm'
import {
  normalizeCodexToolParameters,
  normalizeCodexToolSchemas,
  normalizeOpenAiFunctionToolPayload,
  quarantineCodexTools,
  requiresCodexToolQuarantine,
  requiresObjectRootFunctionSchemas,
} from '../src/codex-tool-schema.ts'

describe('Codex tool-schema compatibility', () => {
  it('projects every strict OpenAI/Codex function-tool route at the final provider seam', () => {
    expect(requiresObjectRootFunctionSchemas('openai-codex', 'future-codex-wire')).toBe(true)
    for (const api of [
      'openai-codex-responses',
      'openai-responses',
      'openai-completions',
      'azure-openai-responses',
    ]) {
      expect(requiresObjectRootFunctionSchemas('custom-openai-compatible', api)).toBe(true)
    }
  })

  it('leaves unrelated provider protocols outside the OpenAI/Codex projection', () => {
    expect(requiresObjectRootFunctionSchemas('anthropic', 'anthropic-messages')).toBe(false)
    expect(requiresObjectRootFunctionSchemas('google', 'google-generative-ai')).toBe(false)
  })

  it('scopes the Monday compatibility quarantine to Codex routes only', () => {
    expect(requiresCodexToolQuarantine('openai-codex', 'future-codex-wire')).toBe(true)
    expect(requiresCodexToolQuarantine('custom', 'openai-codex-responses')).toBe(true)
    expect(requiresCodexToolQuarantine('openai', 'openai-responses')).toBe(false)
    expect(requiresCodexToolQuarantine('azure', 'azure-openai-responses')).toBe(false)
  })

  it('removes every Codex-forbidden root keyword even without a root union', () => {
    const normalized = normalizeCodexToolParameters({
      enum: [{ action: 'create' }],
      const: { action: 'create' },
      not: { type: 'null' },
    })

    expect(normalized.type).toBe('object')
    for (const key of ['oneOf', 'anyOf', 'allOf', 'enum', 'const', 'not']) {
      expect(normalized).not.toHaveProperty(key)
    }
  })

  it('projects a Monday-style root oneOf to an object schema without changing argument names', () => {
    const schema = {
      oneOf: [
        {
          type: 'object',
          properties: {
            action: { const: 'create' },
            board_id: { type: 'string' },
            item_name: { type: 'string' },
          },
          required: ['action', 'board_id', 'item_name'],
          additionalProperties: false,
        },
        {
          type: 'object',
          properties: {
            action: { const: 'update' },
            item_id: { type: 'string' },
            column_values: { type: 'object' },
          },
          required: ['action', 'item_id'],
          additionalProperties: false,
        },
      ],
    }

    const normalized = normalizeCodexToolParameters(schema)

    expect(normalized.type).toBe('object')
    expect(normalized).not.toHaveProperty('oneOf')
    expect(normalized.properties).toMatchObject({
      board_id: { type: 'string' },
      item_name: { type: 'string' },
      item_id: { type: 'string' },
      column_values: { type: 'object' },
      action: { anyOf: [{ const: 'create' }, { const: 'update' }] },
    })
    expect(normalized.required).toEqual(['action'])
  })

  it('unions allOf requirements while keeping the composition off the root', () => {
    const normalized = normalizeCodexToolParameters({
      allOf: [
        {
          type: 'object',
          properties: { board_id: { type: 'string' } },
          required: ['board_id'],
        },
        {
          type: 'object',
          properties: { item_name: { type: 'string' } },
          required: ['item_name'],
        },
      ],
    })

    expect(normalized).toMatchObject({
      type: 'object',
      properties: {
        board_id: { type: 'string' },
        item_name: { type: 'string' },
      },
      required: ['board_id', 'item_name'],
    })
    expect(normalized).not.toHaveProperty('allOf')
  })

  it('leaves already-compatible object schemas untouched', () => {
    const schema = {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
      additionalProperties: false,
    }

    expect(normalizeCodexToolParameters(schema)).toBe(schema)
  })

  it('repairs Responses-style function tools at the final provider payload seam', () => {
    const payload = {
      model: 'gpt-5.6-sol',
      tools: [{
        type: 'function',
        name: 'mcp__fixture__union_tool',
        parameters: {
          oneOf: [
            {
              type: 'object',
              properties: { board_id: { type: 'string' } },
              required: ['board_id'],
            },
            {
              type: 'object',
              properties: { item_id: { type: 'string' } },
              required: ['item_id'],
            },
          ],
        },
      }],
    }

    const normalized = normalizeOpenAiFunctionToolPayload(payload) as typeof payload
    const parameters = normalized.tools[0]?.parameters as Record<string, unknown>

    expect(normalized).not.toBe(payload)
    expect(parameters).toMatchObject({
      type: 'object',
      properties: {
        board_id: { type: 'string' },
        item_id: { type: 'string' },
      },
    })
    expect(parameters).not.toHaveProperty('oneOf')
  })

  it('repairs Chat Completions-style function wrappers without touching non-function tools', () => {
    const passthrough = { type: 'web_search_preview', search_context_size: 'medium' }
    const payload = {
      tools: [
        passthrough,
        {
          type: 'function',
          function: {
            name: 'mcp__fixture__union_tool',
            parameters: {
              anyOf: [
                { type: 'object', properties: { board_id: { type: 'string' } } },
                { type: 'object', properties: { item_id: { type: 'string' } } },
              ],
            },
          },
        },
      ],
    }

    const normalized = normalizeOpenAiFunctionToolPayload(payload) as typeof payload
    expect(normalized.tools[0]).toBe(passthrough)
    const wrapper = normalized.tools[1] as {
      function: { parameters: Record<string, unknown> }
    }
    expect(wrapper.function.parameters.type).toBe('object')
    expect(wrapper.function.parameters).not.toHaveProperty('anyOf')
  })

  it('repairs deferred additional_tools and tool-search output definitions inside Responses input', () => {
    const raw = {
      oneOf: [
        { type: 'object', properties: { board_id: { type: 'string' } } },
        { type: 'object', properties: { item_id: { type: 'string' } } },
      ],
    }
    const payload = {
      tools: [],
      input: [
        { role: 'user', content: [{ type: 'input_text', text: 'use Monday' }] },
        {
          type: 'additional_tools',
          role: 'developer',
          tools: [{
            type: 'function',
            name: 'mcp__fixture__union_tool',
            parameters: raw,
          }],
        },
        {
          type: 'tool_search_output',
          call_id: 'pi_tool_load_1',
          execution: 'client',
          status: 'completed',
          tools: [{
            type: 'function',
            name: 'mcp__fixture__union_tool',
            parameters: raw,
          }],
        },
      ],
    }

    const normalized = normalizeOpenAiFunctionToolPayload(payload) as typeof payload
    for (const index of [1, 2]) {
      const item = normalized.input[index] as {
        tools: Array<{ parameters: Record<string, unknown> }>
      }
      expect(item.tools[0]?.parameters.type).toBe('object')
      expect(item.tools[0]?.parameters).not.toHaveProperty('oneOf')
    }
    expect(normalized.input[0]).toBe(payload.input[0])
  })

  it('repairs pre-wire pi-ai MCP context tools before provider validation', () => {
    const context = {
      tools: [{
        name: 'mcp__monday-com-monday-com__create_action',
        description: 'Monday action',
        parameters: {
          oneOf: [
            { type: 'object', properties: { board_id: { type: 'string' } } },
            { type: 'object', properties: { item_id: { type: 'string' } } },
          ],
        },
      }],
      messages: [],
    }

    const normalized = normalizeOpenAiFunctionToolPayload(context) as typeof context
    const parameters = normalized.tools[0]?.parameters as Record<string, unknown>

    expect(parameters.type).toBe('object')
    expect(parameters).not.toHaveProperty('oneOf')
    expect(parameters.properties).toMatchObject({
      board_id: { type: 'string' },
      item_id: { type: 'string' },
    })
  })

  it('repairs function tools in unknown future nested payload paths', () => {
    const payload = {
      model: 'gpt-5.6-sol',
      transportEnvelope: {
        deferredCatalog: [{
          arbitraryFutureKey: {
            tools: [{
              type: 'function',
              name: 'mcp__fixture__union_tool',
              parameters: {
                oneOf: [
                  { type: 'object', properties: { board_id: { type: 'string' } } },
                  { type: 'object', properties: { item_id: { type: 'string' } } },
                ],
              },
            }],
          },
        }],
      },
    }

    const normalized = normalizeOpenAiFunctionToolPayload(payload) as typeof payload
    const parameters = normalized.transportEnvelope.deferredCatalog[0]
      ?.arbitraryFutureKey.tools[0]?.parameters as Record<string, unknown>

    expect(parameters.type).toBe('object')
    expect(parameters).not.toHaveProperty('oneOf')
    expect(parameters.properties).toMatchObject({
      board_id: { type: 'string' },
      item_id: { type: 'string' },
    })
  })

  it('quarantines Monday create_action from Codex request options while preserving the rest of the catalog', () => {
    const createAction = {
      name: 'mcp__monday-com-monday-com__create_action',
      description: 'Create a Monday action',
      parameters: { type: 'object', properties: {} },
    }
    const getBoards = {
      name: 'mcp__monday-com-monday-com__get_boards',
      description: 'List Monday boards',
      parameters: { type: 'object', properties: {} },
    }
    const options: GenerateOptions = {
      provider: 'openai-codex',
      model: 'gpt-5.6-sol',
      messages: [],
      tools: [createAction, getBoards],
    }

    const quarantined = quarantineCodexTools(options)

    expect(quarantined).not.toBe(options)
    expect(quarantined.tools?.map(tool => tool.name)).toEqual([
      'mcp__monday-com-monday-com__get_boards',
    ])
    expect(options.tools).toHaveLength(2)
  })

  it('removes quarantined Monday create_action entries from final nested provider payloads', () => {
    const payload = {
      tools: [
        {
          type: 'function',
          name: 'mcp__monday-com-monday-com__create_action',
          parameters: { type: 'object', properties: {} },
        },
        {
          type: 'function',
          name: 'mcp__monday-com-monday-com__get_boards',
          parameters: { type: 'object', properties: {} },
        },
      ],
      input: [{
        type: 'additional_tools',
        tools: [{
          type: 'function',
          function: {
            name: 'mcp__monday-com-monday-com__create_action',
            parameters: { type: 'object', properties: {} },
          },
        }],
      }],
    }

    const normalized = normalizeOpenAiFunctionToolPayload(payload, true) as typeof payload

    expect(normalized.tools.map(tool => tool.name)).toEqual([
      'mcp__monday-com-monday-com__get_boards',
    ])
    expect(normalized.input[0]?.tools).toEqual([])
  })

  it('keeps already-compatible final payloads referentially stable', () => {
    const payload = {
      tools: [{
        type: 'function',
        name: 'search',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string' } },
        },
      }],
    }

    expect(normalizeOpenAiFunctionToolPayload(payload)).toBe(payload)
  })

  it('rewrites only incompatible tool entries in a Codex request projection', () => {
    const compatible = {
      name: 'search',
      description: 'Search',
      parameters: { type: 'object', properties: { query: { type: 'string' } } },
    }
    const monday = {
      name: 'mcp__monday-com-monday-com__create_action',
      description: 'Create a Monday action',
      parameters: {
        anyOf: [
          {
            type: 'object',
            properties: { board_id: { type: 'string' } },
            required: ['board_id'],
          },
          {
            type: 'object',
            properties: { workspace_id: { type: 'string' } },
            required: ['workspace_id'],
          },
        ],
      },
    }
    const options: GenerateOptions = {
      provider: 'openai-codex',
      model: 'gpt-5.6-sol',
      messages: [],
      tools: [compatible, monday],
    }

    const normalized = normalizeCodexToolSchemas(options)

    expect(normalized).not.toBe(options)
    expect(normalized.tools?.[0]).toBe(compatible)
    expect(normalized.tools?.[1]?.parameters).toMatchObject({
      type: 'object',
      properties: {
        board_id: { type: 'string' },
        workspace_id: { type: 'string' },
      },
    })
    expect(normalized.tools?.[1]?.parameters).not.toHaveProperty('anyOf')
    expect(options.tools?.[1]?.parameters).toHaveProperty('anyOf')
  })
})

import { describe, expect, it } from 'vitest'
import type { GenerateOptions } from '@phoenix-ai/dsh-llm'
import {
  normalizeCodexToolParameters,
  normalizeCodexToolSchemas,
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

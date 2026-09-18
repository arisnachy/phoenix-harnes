import { CallId } from '@phoenix-ai/dsh-llm'
import type { ToolRunContext } from '@phoenix-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import { createPhoenixVisualizerTool } from '../src/visualize-tool.ts'

function execution(): ToolRunContext {
  const callId = CallId('visual-1')
  return {
    callId,
    rootCallId: callId,
    name: 'phoenix_visualize',
    arguments: {},
    token: Symbol('visual-tool') as never,
    signal: new AbortController().signal,
    deferContext: () => {},
    concludeTurn: () => {},
  }
}

describe('phoenix_visualize tool', () => {
  it('creates a declarative visual artifact without execution authority', async () => {
    const tool = createPhoenixVisualizerTool()
    const args = {
      title: 'Service health',
      visual: {
        visualType: 'metrics',
        metrics: [{ label: 'Availability', value: '99.98%' }],
      },
    }

    const value = await tool.execute(args, execution()) as { artifactId: string; title: string }
    expect(value).toEqual({
      artifactId: 'phoenix-visual:visual-1',
      title: 'Service health',
    })

    expect(tool.output.presentationMeta?.(args, value as never)).toEqual({
      artifact: {
        id: 'phoenix-visual:visual-1',
        mime: 'application/vnd.phoenix.visual+json',
        title: 'Service health',
        data: args.visual,
        executable: false,
      },
    })
  })

  it('describes the visual surface clearly to the model', () => {
    const tool = createPhoenixVisualizerTool()
    expect(tool.name).toBe('phoenix_visualize')
    expect(tool.description).toContain('rich inline Phoenix visual')
    expect(tool.parameters).toEqual(expect.objectContaining({
      type: 'object',
      required: ['title', 'visual'],
      additionalProperties: false,
    }))
  })
})

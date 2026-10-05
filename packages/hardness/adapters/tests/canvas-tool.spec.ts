import { CallId } from '@phoenix-ai/dsh-llm'
import type { ToolRunContext } from '@phoenix-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import { createPhoenixCanvasTool, PHOENIX_CANVAS_MIME } from '../src/canvas-tool.ts'

function execution(): ToolRunContext {
  const callId = CallId('canvas-1')
  return {
    callId,
    rootCallId: callId,
    name: 'phoenix_canvas',
    arguments: {},
    token: Symbol('canvas-tool') as never,
    signal: new AbortController().signal,
    deferContext: () => {},
    concludeTurn: () => {},
  }
}

describe('phoenix_canvas tool', () => {
  it('emits an interactive Phoenix-side canvas artifact', async () => {
    const tool = createPhoenixCanvasTool()
    const args = {
      title: 'Floral dream',
      html: '<canvas id="art"></canvas><script>document.body.dataset.ready="1"</script>',
      interactive: true,
    }

    const value = await tool.execute(args, execution()) as { artifactId: string; title: string }
    expect(value).toEqual({
      artifactId: 'phoenix-canvas:canvas-1',
      title: 'Floral dream',
    })

    expect(tool.output.presentationMeta?.(args, value as never)).toEqual({
      artifact: {
        id: 'phoenix-canvas:canvas-1',
        mime: PHOENIX_CANVAS_MIME,
        title: 'Floral dream',
        data: args.html,
        executable: true,
      },
    })
  })

  it('makes the in-Phoenix canvas contract explicit to the model', () => {
    const tool = createPhoenixCanvasTool()
    expect(tool.name).toBe('phoenix_canvas')
    expect(tool.description).toContain('directly inside Phoenix')
    expect(tool.description).toContain('visual side workspace')
    expect(tool.description).toContain('.canvas.tsx')
    expect(tool.parameters).toEqual(expect.objectContaining({
      type: 'object',
      required: ['title', 'html'],
    }))
  })

  it('supports a static canvas when interaction is explicitly disabled', async () => {
    const tool = createPhoenixCanvasTool()
    const args = { title: 'Report', html: '<h1>Ready</h1>', interactive: false }
    const value = await tool.execute(args, execution()) as { artifactId: string; title: string }
    expect(tool.output.presentationMeta?.(args, value as never)).toMatchObject({
      artifact: { executable: false },
    })
  })
})

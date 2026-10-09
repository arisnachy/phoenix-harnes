import { CallId } from '@phoenix-ai/dsh-llm'
import type { ToolRunContext } from '@phoenix-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'
import { createPhoenixCanvasTool, PHOENIX_CANVAS_MIME } from '../src/canvas-tool.ts'

function execution(onConclude: () => void = () => {}): ToolRunContext {
  const callId = CallId('canvas-1')
  return {
    callId,
    rootCallId: callId,
    name: 'phoenix_canvas',
    arguments: {},
    token: Symbol('canvas-tool') as never,
    signal: new AbortController().signal,
    deferContext: () => {},
    concludeTurn: onConclude,
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
    expect(tool.description).toContain('inside the chat conversation')
    expect(tool.description).toContain('NEVER use phoenix_canvas for an ordinary chart')
    expect(tool.description).toContain('.canvas.tsx')
    expect(tool.description).toContain('delivery completes the request')
    expect(tool.description).toContain('without model calls')
    expect(tool.parameters).toEqual(expect.objectContaining({
      type: 'object',
      required: ['title', 'html'],
    }))
  })

  it('finishes a preview turn immediately instead of launching model-side reviews', async () => {
    const concludeTurn = vi.fn()
    await createPhoenixCanvasTool().execute({ title: 'Demo', html: '<form><input></form>' }, execution(concludeTurn))
    expect(concludeTurn).toHaveBeenCalledOnce()
  })

  it('continues only for explicitly requested follow-up work', async () => {
    const concludeTurn = vi.fn()
    await createPhoenixCanvasTool().execute({
      title: 'Save after showing', html: '<h1>Preview</h1>', continueAfterDisplay: true,
    }, execution(concludeTurn))
    expect(concludeTurn).not.toHaveBeenCalled()
  })

  it('does not conclude a failed canvas validation', async () => {
    const concludeTurn = vi.fn()
    await expect(createPhoenixCanvasTool().execute({ title: 'Demo', html: '' }, execution(concludeTurn))).rejects.toThrow('html must be a non-empty string')
    expect(concludeTurn).not.toHaveBeenCalled()
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

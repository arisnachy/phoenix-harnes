import { CallId } from '@phoenix-ai/dsh-llm'
import type { ToolRunContext } from '@phoenix-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'
import { createPhoenixGameTool, PHOENIX_GAME_MIME } from '../src/game-tool.ts'

const runnable = `<!doctype html><html lang="es"><body>
<canvas width="320" height="180" id="game"></canvas>
<script id="phoenix-game-manifest" type="application/json">
{"schemaVersion":1,"title":"Luz de selva","genre":"puzzle","gameType":"puzzle",
"level":{"layers":[{"id":"board","scrollFactor":0}],"puzzles":[{"id":"connect"}]},
"controls":{"interact":"Enter"},"audio":{"cues":["click"]}}
</script>
<script>
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
ctx.fillRect(0,0,12,12);
document.addEventListener('keydown', e => { if(e.key==='Enter') ctx.fillRect(12,0,12,12); });
</script></body></html>`

function execution(conclude = vi.fn()): ToolRunContext {
  const callId = CallId('game-call-1')
  return {
    callId,
    rootCallId: callId,
    name: 'phoenix_game',
    arguments: {},
    token: Symbol('game') as never,
    signal: new AbortController().signal,
    deferContext: () => {},
    concludeTurn: conclude,
  }
}

describe('Phoenix Game Studio publisher', () => {
  it('is a real registered model tool with game-specific instructions', () => {
    const tool = createPhoenixGameTool()
    expect(tool.name).toBe('phoenix_game')
    expect(tool.description).toContain('actual in-chat game publisher')
    expect(tool.description).toContain('spawn_teammate')
    expect(tool.parameters).toMatchObject({ type: 'object', required: ['title', 'html'] })
  })

  it('publishes self-contained game HTML through the renderer’s executable MIME', async () => {
    const tool = createPhoenixGameTool()
    const conclude = vi.fn()
    const args = { title: 'Luz de selva', html: runnable }
    const result = await tool.execute(args, execution(conclude)) as {
      artifactId: string; title: string; preflight: string
    }
    expect(result).toEqual({
      artifactId: 'phoenix-game:game-call-1',
      title: args.title,
      preflight: 'packaging-only',
    })
    expect(tool.output.presentationMeta?.(args, result as never)).toEqual({
      artifact: {
        id: result.artifactId,
        mime: PHOENIX_GAME_MIME,
        title: args.title,
        data: runnable,
        executable: true,
      },
    })
    expect(conclude).not.toHaveBeenCalled()
  })

  it('rejects image-only, inert HTML, and game declarations without executable code', async () => {
    const tool = createPhoenixGameTool()
    const attempt = async (html: string): Promise<unknown> =>
      tool.execute({ title: 'Test game', html }, execution())
    await expect(attempt('')).rejects.toThrow('vacío')
    await expect(attempt('<img src="data:image/png;base64,abcd">')).rejects.toThrow('manifiesto')
    await expect(attempt(runnable.replace(/<script>[^]*?<\/script>/u, '')))
      .rejects.toThrow('JavaScript ejecutable')
    await expect(attempt(runnable.replace('<canvas width="320" height="180" id="game"></canvas>', '')))
      .rejects.toThrow('superficie interactiva')
  })

  it('blocks remote runtime dependencies and invalid manifests before publishing', async () => {
    const tool = createPhoenixGameTool()
    const attempt = async (html: string): Promise<unknown> =>
      tool.execute({ title: 'Unsafe', html }, execution())
    await expect(attempt(runnable.replace('<body>', '<body><script src="https://cdn.example/game.js"></script>')))
      .rejects.toThrow('CDN')
    await expect(attempt(runnable.replace('ctx.fillRect(0,0,12,12)', 'fetch("https://example.org/data")')))
      .rejects.toThrow('sin red')
    await expect(attempt(runnable.replace('"schemaVersion":1', '"schemaVersion":9')))
      .rejects.toThrow('schemaVersion:1')
  })
})

import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CallId } from '@phoenix-ai/dsh-llm'
import type { ToolRunContext } from '@phoenix-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'
import { createPhoenixGameTool, PHOENIX_GAME_MIME, preparePhoenixGameSubmission, validateGameHtml } from '../src/game-tool.ts'

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
    expect(tool.parameters).toMatchObject({ type: 'object', required: ['title'] })
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

  it('publishes a newly authored game on the FIRST call when Kira supplies separate manifest_json', async () => {
    const tool = createPhoenixGameTool()
    const manifest = /<script id="phoenix-game-manifest" type="application\/json">([\s\S]*?)<\/script>/u.exec(runnable)?.[1]
    if (manifest === undefined) throw new Error('Missing test manifest')
    const source = runnable.replace(/<script id="phoenix-game-manifest" type="application\/json">[\s\S]*?<\/script>/u, '')
    const args = { title: 'Luz de selva', html: source, manifest_json: manifest }
    const receipt = await tool.execute(args, execution()) as { artifactId: string; title: string; preflight: string }
    const output = tool.output.presentationMeta?.(args, receipt as never) as { artifact?: { data?: string } } | undefined
    expect(receipt.preflight).toBe('packaging-only')
    expect(output?.artifact?.data).toContain('id="phoenix-game-manifest" type="application/json"')
    expect(output?.artifact?.data).toContain('canvas.getContext')
    expect(output?.artifact?.data).not.toBe(source)
    expect(tool.parameters).toMatchObject({ type: 'object', required: ['title'] })
    expect(tool.description).toContain('manifest_json')
  })

  it('publishes authored HTML from the agent workspace without retransmitting its source', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'phoenix-game-publish-'))
    try {
      const filename = 'racer.html'
      writeFileSync(join(folder, filename), runnable)
      const tool = createPhoenixGameTool()
      const args = { title: 'Racer', file_path: filename }
      const exec: ToolRunContext = {
        ...execution(),
        agent: { session: { header: { cwd: folder } } } as never,
      }
      const receipt = await tool.execute(args, exec) as {
        artifactId: string
        title: string
        preflight: string
        html: string
      }
      expect(receipt.preflight).toBe('packaging-only')
      expect(receipt.html).toBe(runnable)
      // A modified file AFTER the accepted call cannot alter the published artifact.
      writeFileSync(join(folder, filename), '<html>changed after publication</html>')
      const presented = tool.output.presentationMeta?.(args, receipt as never) as {
        artifact?: { data?: string, mime?: string }
      }
      expect(presented.artifact?.data).toBe(runnable)
      expect(presented.artifact?.mime).toBe(PHOENIX_GAME_MIME)
      expect(JSON.stringify(tool.output.render(args, receipt as never))).not.toContain('<canvas')
    } finally { rmSync(folder, { recursive: true, force: true }) }
  })

  it('rejects workspace escapes, missing game files and ambiguous publishing inputs', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'phoenix-game-scope-'))
    const outside = mkdtempSync(join(tmpdir(), 'phoenix-game-external-'))
    try {
      writeFileSync(join(folder, 'ready.html'), runnable)
      writeFileSync(join(outside, 'secret.html'), runnable)
      writeFileSync(join(folder, 'oversize.html'), 'a'.repeat(16 * 1024 * 1024 + 1))
      mkdirSync(join(folder, 'sub'))
      const tool = createPhoenixGameTool()
      const exec: ToolRunContext = {
        ...execution(),
        agent: { session: { header: { cwd: folder } } } as never,
      }
      const run = (file_path: string): Promise<unknown> =>
        tool.execute({ title: 'Check', file_path }, exec)
      await expect(run(join(outside, 'secret.html'))).rejects.toThrow('dentro del espacio de trabajo')
      await expect(run('../' + outside.split(/[\\/]/u).at(-1) + '/secret.html')).rejects.toThrow('dentro del espacio de trabajo')
      await expect(run('https://example.org/demo.html')).rejects.toThrow('local')
      await expect(run('missing.html')).rejects.toThrow('no existe')
      await expect(run('oversize.html')).rejects.toThrow('16 MiB')
      await expect(run('sub')).rejects.toThrow('dentro del espacio de trabajo')
      if (process.platform !== 'win32') {
        symlinkSync(join(outside, 'secret.html'), join(folder, 'sneaky.html'))
        await expect(run('sneaky.html')).rejects.toThrow('dentro del espacio de trabajo')
      }
      await expect(tool.execute({ title: 'none' }, exec)).rejects.toThrow('exactamente uno')
      await expect(tool.execute({ title: 'both', html: runnable, file_path: 'ready.html' }, exec))
        .rejects.toThrow('exactamente uno')
      await expect(tool.execute({ title: 'no agent', file_path: 'ready.html' }, execution()))
        .rejects.toThrow('directorio de trabajo')
    } finally {
      rmSync(folder, { recursive: true, force: true })
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('repairs the manifest wrapper when JSON exists but Kira omitted the exact script id', () => {
    const source = runnable.replace(' id="phoenix-game-manifest"', '')
    const fixed = preparePhoenixGameSubmission(source)
    expect(fixed).toContain('id="phoenix-game-manifest"')
    expect(preparePhoenixGameSubmission(fixed)).toBe(fixed)
  })

  it('keeps authored entity metadata intact and rejects ambiguous or contradicting contracts', () => {
    const match = /<script id="phoenix-game-manifest" type="application\/json">([\s\S]*?)<\/script>/u.exec(runnable)
    const raw = match?.[1]
    if (raw === undefined) throw new Error('Missing test metadata')
    const missing = runnable.replace(match?.[0] ?? '', '')
    expect(() => preparePhoenixGameSubmission(missing)).toThrow('manifest_json')
    expect(() => preparePhoenixGameSubmission(runnable, JSON.stringify({ schemaVersion: 1, title: 'Other', genre: 'puzzle' })))
      .toThrow('no coincide')
    expect(() => preparePhoenixGameSubmission(missing, '{invalid')).toThrow('JSON')
    expect(() => preparePhoenixGameSubmission(missing, JSON.stringify({ schemaVersion: 1, title: 'Fake', genre: 'puzzle' })))
      .not.toThrow()
    // Formatting a JSON envelope is not certification of invented controls,
    // levels or audio: the actual publisher still rejects that fake contract.
    expect(() => validateGameHtml(preparePhoenixGameSubmission(missing, JSON.stringify({ schemaVersion: 1, title: 'Fake', genre: 'puzzle' }))))
      .toThrow('controls')
  })

  it('requires controls, level and audio before publication, not after an iframe fails', async () => {
    const tool = createPhoenixGameTool()
    const incomplete = runnable.replace('"controls":{"interact":"Enter"},', '')
    await expect(tool.execute({ title: 'Missing controls', html: incomplete }, execution())).rejects.toThrow('controls')
    const withoutAudio = runnable.replace(',"audio":{"cues":["click"]}', '')
    await expect(tool.execute({ title: 'Missing audio', html: withoutAudio }, execution())).rejects.toThrow('audio')
  })

  it('distinguishes a brawler prototype from false finished production', () => {
    const game = runnable.replace('"genre":"puzzle","gameType":"puzzle"', '"genre":"beat-em-up","gameType":"beat-em-up"')
      .replace('"controls":{"interact":"Enter"}', '"controls":{"move":"WASD"}')
      .replace('"audio":{"cues":["click"]}', '"audio":{"cues":["hit"]},"art":{"mode":"prototype"}')
    expect(validateGameHtml(game).artPreflight).toBe('prototype')
    const dishonest = game.replace('"art":{"mode":"prototype"}', '"art":{"mode":"production"}')
    expect(() => validateGameHtml(dishonest)).toThrow('control necesario')
  })

  it('requires embedded action samples, soundtrack and a playback route when claiming production sound', () => {
    const declared = runnable.replace('"audio":{"cues":["click"]}',
      '"audio":{"mode":"sampled-production","cues":["click"]}')
    expect(() => validateGameHtml(declared)).toThrow('sonido grabado')
    const wav = Buffer.alloc(48)
    wav.write('RIFF', 0, 'ascii')
    wav.write('WAVE', 8, 'ascii')
    const data = wav.toString('base64')
    const tags = ['click', 'music'].map(cue => '<audio id="phoenix-audio-' + cue
      + '" src="data:audio/wav;base64,' + data + '"></audio>').join('')
    const clips = declared.replace('</body>', tags + '</body>')
    expect(() => validateGameHtml(clips)).toThrow('reproducción')
    const played = clips.replace('ctx.fillRect(0,0,12,12);',
      'ctx.fillRect(0,0,12,12);document.getElementById("phoenix-audio-click").play();')
    expect(validateGameHtml(played).title).toBe('Luz de selva')
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
  it('does not silently publish a box character as finished professional game art', async () => {
    const tool = createPhoenixGameTool()
    const shooter = runnable.replace('"genre":"puzzle","gameType":"puzzle"',
      '"genre":"run-and-gun","gameType":"run-and-gun"')
    await expect(tool.execute({ title: 'Hero mismatch', html: shooter }, execution()))
      .rejects.toThrow('art.mode')
    const prototype = shooter.replace('"level":{"layers"', '"art":{"mode":"prototype"},"level":{"layers"')
    const receipt = await tool.execute({ title: 'Prototype only', html: prototype }, execution()) as {
      preflight: string
    }
    expect(receipt.preflight).toBe('prototype-only')
    const duplicated = runnable.replace('</body>',
      '<script id="phoenix-game-manifest" type="application/json">{}</script></body>')
    await expect(tool.execute({ title: 'Duplicate', html: duplicated }, execution()))
      .rejects.toThrow('más de un')
  })

})

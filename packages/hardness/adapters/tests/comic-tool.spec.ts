import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CallId } from '@phoenix-ai/dsh-llm'
import type { ToolRunContext } from '@phoenix-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import { createPhoenixComicTool, PHOENIX_COMIC_MIME, readComicRelease, readWorkspaceComicHtml, validateComicHtml } from '../src/comic-tool.ts'

const art = 'iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAIAAABMXPacAAABMElEQVR4nO3RMQ0AIADAMMAZPvCDbWT0YFWwZPPsO+IsHfC7BmANwBqANQBrANYArAFYA7AGYA3AGoA1AGsA1gCsAVgDsAZgDcAagDUAawDWAKwBWAOwBmANwBqANQBrANYArAFYA7AGYA3AGoA1AGsA1gCsAVgDsAZgDcAagDUAawDWAKwBWAOwBmANwBqANQBrANYArAFYA7AGYA3AGoA1AGsA1gCsAVgDsAZgDcAagDUAawDWAKwBWAOwBmANwBqANQBrANYArAFYA7AGYA3AGoA1AGsA1gCsAVgDsAZgDcAagDUAawDWAKwBWAOwBmANwBqANQBrANYA7AGikQIkd+ic2QAAAABJRU5ErkJggg=='
const html = '<!doctype html><html lang="es"><head><title>Una aventura</title></head><body>'
  + '<main class="edition"><section class="comic-cover-page cover-front" data-comic-cover="front">'
  + '<img alt="Portada" src="data:image/png;base64,' + art + '"></section>'
  + '<section class="comic-page" aria-label="Página 1">'
  + '<article class="panel" role="group"><img class="art" alt="Luna señala la ciudad" src="data:image/png;base64,'
  + art + '"><div class="dialogues"><div class="bubble">¡Vamos!</div></div></article>'
  + '<div class="page-number">1</div></section>'
  + '<section class="comic-cover-page cover-back" data-comic-cover="back">'
  + '<img alt="Contraportada" src="data:image/png;base64,' + art + '"></section></main></body></html>'
function execContext(cwd?: string): ToolRunContext {
  const callId = CallId('comic-1')
  return {
    callId, rootCallId: callId, name: 'phoenix_comic', arguments: {},
    token: Symbol('comic') as never, signal: new AbortController().signal,
    deferContext: () => {}, concludeTurn: () => {},
    ...(cwd === undefined ? {} : { agent: { session: { header: { cwd } } } as never }),
  }
}

describe('Phoenix Comic Studio: actual in-chat publication', () => {
  it('registers native model tool and renderer MIME', async () => {
    const tool = createPhoenixComicTool()
    expect(tool.name).toBe('phoenix_comic')
    expect(tool.description).toContain('NEVER navigate')
    const receipt = await tool.execute({ title: 'Una aventura', html }, execContext()) as {
      artifactId: string; title: string; pages: number; panels: number; html: string
    }
    expect(receipt).toEqual({
      artifactId: 'phoenix-comic:comic-1', title: 'Una aventura', pages: 3, panels: 1, html,
    })
    expect(tool.output.presentationMeta?.({ title: receipt.title, html }, receipt as never)).toEqual({
      artifact: { id: receipt.artifactId, title: receipt.title, mime: PHOENIX_COMIC_MIME,
        data: html, executable: false },
    })
    expect(validateComicHtml(html)).toEqual({ pages: 3, panels: 1 })
    expect(() => validateComicHtml(html.replace('data-comic-cover="back"', 'data-comic-cover="missing"'))).toThrow(/contraportada|portada/)
  })

  it('rejects recursive localhost browsing, empty comics, script injection and dummy pictures', async () => {
    expect(() => validateComicHtml(html.replace('Una aventura', 'http://127.0.0.1:3080/'))).toThrow(/navegación/)
    expect(() => validateComicHtml(html.replace('</body>', '<iframe src="http://localhost:3080/"></iframe></body>'))).toThrow(/navegación/)
    expect(() => validateComicHtml(html.replace('</body>', '<script>alert(1)</script></body>'))).toThrow(/navegación/)
    expect(() => validateComicHtml(html.replaceAll('data:image/png;base64,' + art, 'imagen-pendiente.png'))).toThrow(/ilustración|cubierta|portada/)
    expect(() => validateComicHtml(html.replaceAll('data:image/png;base64,' + art, 'data:image/png;base64,iVBORw0KGgo='))).toThrow(/ilustración|cubierta|portada/)
    const tool = createPhoenixComicTool()
    await expect(tool.execute({ title: 'Sin cómic', html: '<h1>Ya está publicado</h1>' }, execContext())).rejects.toThrow(/HTML/)
    await expect(tool.execute({ title: 'Ambiguo', html, file_path: 'otro.html' }, execContext())).rejects.toThrow(/uno solamente/)
  })

  it('reads only scoped workspace editions and persists the captured artifact bytes', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'comic-workspace-'))
    const outside = mkdtempSync(join(tmpdir(), 'comic-outside-'))
    try {
      writeFileSync(join(workspace, 'comic.html'), html)
      writeFileSync(join(outside, 'comic.html'), html)
      symlinkSync(join(outside, 'comic.html'), join(workspace, 'unsafe.html'))
      expect(readWorkspaceComicHtml('comic.html', workspace)).toBe(html)
      expect(() => readWorkspaceComicHtml('unsafe.html', workspace)).toThrow(/externo/)
      expect(() => readWorkspaceComicHtml('../outside.html', workspace)).toThrow(/no existe/)
      const tool = createPhoenixComicTool()
      const args = { title: 'Cómic original', file_path: 'comic.html' }
      const receipt = await tool.execute(args, execContext(workspace)) as { html: string; artifactId: string }
      writeFileSync(join(workspace, 'comic.html'), '<html>Alterado</html>')
      const meta = tool.output.presentationMeta?.(args, receipt as never) as { artifact?: { data?: unknown } }
      expect(meta.artifact?.data).toBe(html)
    } finally { rmSync(workspace, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }) }
  })

  it('publishes only a SHA-256 checked, non-draft, audited persistent comic release', async () => {
    const home = mkdtempSync(join(tmpdir(), 'comic-release-'))
    const old = process.env.PHOENIX_COMICS_HOME
    try {
      process.env.PHOENIX_COMICS_HOME = home
      const folder = join(home, 'series', 'guardianes', 'releases', 'numero-uno')
      mkdirSync(folder, { recursive: true })
      const htmlPath = join(folder, 'comic.html')
      const receiptPath = join(folder, 'release.json')
      writeFileSync(htmlPath, html)
      const receipt = {
        schemaVersion: 1, seriesId: 'guardianes', issueId: 'numero-uno',
        formats: ['html'], draft: false, structurallyValid: true, editorialComplete: true,
        sha256: { html: createHash('sha256').update(html).digest('hex') },
      }
      writeFileSync(receiptPath, JSON.stringify(receipt))
      expect(readComicRelease('guardianes', 'numero-uno')).toBe(html)
      const published = await createPhoenixComicTool().execute({
        title: 'Guardianes #1', series_id: 'guardianes', issue_id: 'numero-uno',
      }, execContext()) as { pages: number; panels: number }
      expect(published).toMatchObject({ pages: 3, panels: 1 })
      writeFileSync(htmlPath, html + 'alterado')
      expect(() => readComicRelease('guardianes', 'numero-uno')).toThrow(/modificado/)
      writeFileSync(htmlPath, html)
      writeFileSync(receiptPath, JSON.stringify({ ...receipt, draft: true }))
      expect(() => readComicRelease('guardianes', 'numero-uno')).toThrow(/recibo editorial/)
    } finally {
      if (old === undefined) delete process.env.PHOENIX_COMICS_HOME
      else process.env.PHOENIX_COMICS_HOME = old
      rmSync(home, { recursive: true, force: true })
    }
  })
})

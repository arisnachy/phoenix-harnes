// @vitest-environment jsdom
/** Dynamic ui-theme entry owns the global styles in dependency order. */
import { Context } from '@phoenix-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { installThemeStyles } from '../src/client/styles.ts'

const PLUGIN_ID = '@phoenix-ai/dsh-client-ui-theme'

afterEach(() => {
  document.head.querySelectorAll(`style[data-plugin="${PLUGIN_ID}"]`).forEach((node) => { node.remove() })
})

describe('ui-theme client styles', () => {
  it('does not drop global theme styles when a previous plugin owner disposes during a hot restart', async () => {
    const first = new Context().plugin({ apply(scope) { installThemeStyles(scope) } })
    await first.await()
    const original = [...document.head.querySelectorAll<HTMLStyleElement>(`style[data-plugin="${PLUGIN_ID}"]`)]
    expect(original).toHaveLength(5)

    const replacement = new Context().plugin({ apply(scope) { installThemeStyles(scope) } })
    await replacement.await()
    const combined = [...document.head.querySelectorAll<HTMLStyleElement>(`style[data-plugin="${PLUGIN_ID}"]`)]
    expect(combined).toEqual(original)
    await first.dispose()
    expect([...document.head.querySelectorAll<HTMLStyleElement>(`style[data-plugin="${PLUGIN_ID}"]`)]).toEqual(original)
    await replacement.dispose()
    expect(document.head.querySelectorAll(`style[data-plugin="${PLUGIN_ID}"]`)).toHaveLength(0)
  })

  it('rebuilds an unexpectedly detached global stylesheet on the next mount', async () => {
    const first = new Context().plugin({ apply(scope) { installThemeStyles(scope) } })
    await first.await()
    const old = document.head.querySelector<HTMLStyleElement>(`style[data-plugin-css="${PLUGIN_ID}/base.css"]`)
    expect(old).not.toBeNull()
    old?.remove()
    const next = new Context().plugin({ apply(scope) { installThemeStyles(scope) } })
    await next.await()
    const restored = document.head.querySelector(`style[data-plugin-css="${PLUGIN_ID}/base.css"]`)
    expect(restored).not.toBeNull()
    expect(restored).not.toBe(old)
    await first.dispose()
    expect(restored?.isConnected).toBe(true)
    await next.dispose()
    expect(restored?.isConnected).toBe(false)
  })

  it('mounts every global sheet in dependency order and removes them on dispose', async () => {
    const ctx = new Context()
    const fiber = ctx.plugin({
      apply(scope) { installThemeStyles(scope) },
    })
    await fiber.await()

    const styles = [...document.head.querySelectorAll<HTMLStyleElement>(`style[data-plugin="${PLUGIN_ID}"]`)]
    expect(styles.map(style => style.dataset.pluginCss)).toEqual([
      `${PLUGIN_ID}/base.css`,
      `${PLUGIN_ID}/design-platform.css`,
      `${PLUGIN_ID}/scrollbar.css`,
      `${PLUGIN_ID}/gradient-shadow-text.css`,
      `${PLUGIN_ID}/shiki.css`,
    ])
    await fiber.dispose()
    expect(document.head.querySelectorAll(`style[data-plugin="${PLUGIN_ID}"]`)).toHaveLength(0)
  })
})

import type { Context } from '@phoenix-ai/cordis'
import base from '../styles/base.css?inline'
import designPlatform from '../styles/design-platform.css?inline'
import scrollbar from '../styles/scrollbar.css?inline'
import gradientShadowText from '../styles/gradient-shadow-text.css?inline'
import shiki from '../styles/shiki.css?inline'

const PLUGIN_ID = '@phoenix-ai/dsh-client-ui-theme'

const STYLES = [
  ['base.css', base],
  ['design-platform.css', designPlatform],
  ['scrollbar.css', scrollbar],
  ['gradient-shadow-text.css', gradientShadowText],
  ['shiki.css', shiki],
] as const

/** A single stylesheet must survive overlapping plugin mounts during HMR or restart. */
interface StyleLease {
  readonly tag: HTMLStyleElement
  owners: number
}

const leases = new Map<string, StyleLease>()

/**
 * Mount the global theme styles exactly once per document, retaining them
 * until the LAST owning plugin is disposed. A new owner also repairs a style
 * node detached by an interrupted HMR cycle without touching user settings.
 * @param ctx - Owning plugin context.
 */
export function installThemeStyles(ctx: Context): void {
  if (typeof document === 'undefined') return
  for (const [name, css] of STYLES) {
    ctx.effect(() => {
      const key = `${PLUGIN_ID}/${name}`
      let lease = leases.get(key)
      if (lease === undefined || !lease.tag.isConnected || lease.tag.ownerDocument !== document) {
        const tag = document.createElement('style')
        tag.dataset.plugin = PLUGIN_ID
        tag.dataset.pluginCss = key
        tag.textContent = css
        document.head.appendChild(tag)
        lease = { tag, owners: 0 }
        leases.set(key, lease)
      }
      lease.owners += 1
      const owned = lease
      return () => {
        owned.owners -= 1
        if (owned.owners !== 0) return
        if (leases.get(key) === owned) leases.delete(key)
        owned.tag.remove()
      }
    }, `ui-theme: ${name} stylesheet`)
  }
}

/**
 * Read-only, redacted diagnosis of a Chrome tab. No cookies, tokens, form
 * values, personal page text, resource URLs or account identifiers escape.
 * The browser may report an iframe as blocked without the main page failing.
 */
export interface SitePageHealth {
  readyState: string
  hasPasswordForm: boolean
  mainTextLength: number
  visibleTextLength: number
  blockedMarker: boolean
  iframeCount: number
  crossOriginFrames: number
  firstPartyResourceFailures: number
  scriptCount: number
}

/** Classification of an observed site availability problem. */
export type SiteHealthKind =
  | 'partial_or_embedded_block'
  | 'page_reports_blocked'
  | 'resource_failure'
  | 'blank_or_unrendered'
  | 'loading'
  | 'content_visible'

/** Classify site health from the observed page evidence.
 * @param p - P supplied to this operation.
 * @returns The result produced by this operation.
 */
export function classifySiteHealth(p: SitePageHealth): SiteHealthKind {
  if (p.blockedMarker && (p.mainTextLength > 90 || p.crossOriginFrames > 0)) return 'partial_or_embedded_block'
  if (p.blockedMarker) return 'page_reports_blocked'
  if (p.readyState === 'loading') return 'loading'
  if (p.firstPartyResourceFailures > 0 && p.mainTextLength < 100) return 'resource_failure'
  if (p.mainTextLength < 60) return 'blank_or_unrendered'
  return 'content_visible'
}

/** Browser expression used to inspect site health. */
export const siteHealthExpression = `(() => {
  const body = document.body;
  const visible = (body?.innerText || '').slice(0, 15000);
  const main = document.querySelector('main,[role="main"],#sportsbook,#sports,#app,#root');
  const mainText = (main?.innerText || '').slice(0, 15000);
  const blocked = /(?:^|\\s)(?:blocked|access denied|acceso denegado|forbidden)(?:\\s|$)/i.test(visible);
  const frames = Array.from(document.querySelectorAll('iframe'));
  const crossOriginFrames = frames.filter(frame => {
    try {
      const url = new URL(frame.src, location.href);
      return url.origin !== location.origin && (url.protocol === 'https:' || url.protocol === 'http:');
    } catch { return false; }
  }).length;
  const resources = performance.getEntriesByType('resource');
  const failed = resources.filter(entry => {
    try {
      if (new URL(entry.name).origin !== location.origin) return false;
      const status = Number(entry.responseStatus || 0);
      return status === 403 || status === 429 || status >= 500;
    } catch { return false; }
  }).length;
  return JSON.stringify({
    readyState: document.readyState,
    hasPasswordForm: Boolean(document.querySelector('input[type="password"]')),
    mainTextLength: mainText.length,
    visibleTextLength: visible.length,
    blockedMarker: blocked,
    iframeCount: frames.length,
    crossOriginFrames,
    firstPartyResourceFailures: failed,
    scriptCount: document.scripts.length,
  });
})()`

/** Choose the next bounded recovery action from site health evidence.
 * @param kind - Kind supplied to this operation.
 * @returns The result produced by this operation.
 */
export function nextSiteRecoveryStep(kind: SiteHealthKind): string {
  switch (kind) {
    case 'loading':
      return 'Esperar brevemente y repetir una sola comprobación de la misma pestaña.'
    case 'blank_or_unrendered':
      return 'Inspeccionar enlaces de navegación internos y comprobar si el contenido carga en otra ruta oficial; no inventar mercados.'
    case 'resource_failure':
      return 'Consultar el estado de recursos del sitio y reabrir una ruta oficial mediante la navegación autorizada; no modificar sesiones ni credenciales.'
    case 'partial_or_embedded_block':
      return 'La página principal puede funcionar aunque un módulo o iframe falle. Inspeccionar primero el contenido propio y enlaces oficiales; no asumir que toda la web está bloqueada.'
    case 'page_reports_blocked':
      return 'Comprobar si es una denegación del servidor o un error de aplicación. No eludir mecanismos de seguridad del sitio.'
    case 'content_visible':
      return 'Continuar inspeccionando el DOM de la página existente antes de declarar la tarea imposible.'
  }
}

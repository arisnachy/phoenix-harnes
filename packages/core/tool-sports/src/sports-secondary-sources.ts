/**
 * Public sportsbook-comparison RESEARCH directory for Kira.
 *
 * These editorial websites are NOT PHOENIX live-price adapters. Being publicly
 * viewable does not authorize scraping, and a page-view timestamp is never a
 * sportsbook quote-update timestamp.
 */
export const secondarySportsSources = [
  {
    id:'scoresandodds',name:'ScoresAndOdds',
    url:'https://www.scoresandodds.com/',
    researchUrl:'https://www.scoresandodds.com/las-vegas-odds',
    hosts:['www.scoresandodds.com','scoresandodds.com'],
    focus:'Principalmente deportes norteamericanos y comparaciones de encuentros.',
    capabilities:['comparación de cuotas','movimientos de líneas','boxscores','tendencias de apuestas'],
    limitation:'El historial de movimientos y la cobertura varían según partido y mercado.',
  },
  {
    id:'covers',name:'Covers',
    url:'https://www.covers.com/',
    researchUrl:'https://www.covers.com/sport/odds',
    hosts:['www.covers.com','covers.com'],
    focus:'Cuadros de cuotas por liga, casas, líneas de apertura y movimientos.',
    capabilities:['moneyline','spread','totales','línea de apertura','comparación entre casas','consenso de usuarios'],
    limitation:'Los precios pueden mostrar retraso. La hora de visita NO prueba actualización del bookmaker.',
  },
  {
    id:'vegasinsider',name:'VegasInsider',
    url:'https://www.vegasinsider.com/',
    researchUrl:'https://www.vegasinsider.com/nba/odds/las-vegas/',
    hosts:['www.vegasinsider.com','vegasinsider.com'],
    focus:'Cuotas comparadas, tendencias, líneas de apertura y consenso por competición.',
    capabilities:['moneyline','spread','totales','línea de apertura','movimientos','consenso'],
    limitation:'El consenso es opinión/mercado, no un modelo independiente de probabilidad de victoria.',
  },
  {
    id:'oddsportal',name:'OddsPortal',
    url:'https://www.oddsportal.com/',
    researchUrl:'https://www.oddsportal.com/',
    hosts:['www.oddsportal.com','oddsportal.com'],
    focus:'Comparación internacional, especialmente fútbol y tenis donde haya cobertura.',
    capabilities:['comparación de cuotas','mercados internacionales','históricos parciales'],
    limitation:'No hay extracción automática incorporada; comprobar permisos, acceso regional y condiciones del sitio.',
  },
] as const

export type SecondarySportsSourceId=typeof secondarySportsSources[number]['id']
export const secondaryMarketWorkflow = [
  '1. Obtén partido, liga, fecha/hora y eventId/competitionId reales desde ESPN Scoreboard; no traduzcas el ID ESPN al de otra web.',
  '2. Usa sports_chat_odds y sports_chat_espn_core para intentar cuotas de ESPN con casa, mercado, línea y timestamp propios.',
  '3. Si faltan precios o se necesita contrastar, elige un sitio de este catálogo. Solo consulta páginas mediante navegación permitida; no hay scraper/API oficial instalada de estos cuatro portales.',
  '4. Verifica ambos participantes, competición, fecha, zona horaria, condición de prepartido y período del mercado en CADA portal; nombres similares no prueban identidad.',
  '5. Registra URL exacta, nombre de casa, mercado (moneyline/1X2/spread/total), selección, precio, punto/línea y fecha de consulta. Distingue cuándo se VISITÓ la página de cuándo la CASA actualizó el precio.',
  '6. Si falta fecha de actualización de la casa, etiqueta la cifra «observación para investigación; vigencia no verificada». Si la página refleja línea inicial o histórico, etiqueta «histórico».',
  '7. Una cifra de comparador, aunque tenga hora de actualización, es referencia de terceros y NO cotización ni aceptación en casa. No la conviertas en ticket apostable sin verificar un proveedor autorizado.',
] as const
export const secondaryMarketPolicy = {
  registryStatus:'reference_only',
  retrievalStatus:'not_attempted',
  automaticAdapters:false,
  sportsbookExecution:false,
  requireAuthorizedAccess:true,
  noBypass:'Nunca eludir CAPTCHA, login, paywalls, robots, geobloqueos o limitaciones del proveedor.',
  timestampRule:'pageObservedAt y quoteUpdatedAt son campos DIFERENTES; el primero no sustituye al segundo.',
  identityRule:'Equipos + liga + fecha/hora + mercado + selección + período y casa deben coincidir; no emparejar solo por nombre.',
  attributionRule:'Conservar URL de página, operador, línea, timestamp y estado de verificación; no decir que un sitio fue consultado si no se navegó realmente.',
  favoriteRule:'Favorito de mercado por precio observado ≠ favorito de un análisis deportivo independiente y validado.',
} as const

/** Identify an attributed page without fetching it or trusting arbitrary hosts. */
export function isKnownSecondaryMarketPage(sourceId:string,href:string):boolean {
  const source=secondarySportsSources.find(item=>item.id===sourceId)
  if(!source||typeof href!=='string'||href.length>1200)return false
  try{
    const url=new URL(href)
    return url.protocol==='https:'&&!url.username&&!url.password&&!url.port
      &&source.hosts.some(host=>host===url.hostname)
  }catch{return false}
}

/** Bounded, read-only directory for a human or an authorized browser workflow. */
export function secondaryMarketSourceCatalog(){
  return {sources:secondarySportsSources,workflow:secondaryMarketWorkflow,
    policy:secondaryMarketPolicy,
    instruction:'Estos son portales para investigación complementaria, no feeds API activados. Si no puedes navegar su contenido, indícalo: no inventes cuotas, movimientos ni marcas temporales. Las cuotas sin marca de actualización no son precios actuales verificables.'}
}

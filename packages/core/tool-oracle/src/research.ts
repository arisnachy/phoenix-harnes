/** Source discovery for arbitrary user questions via the already-authorized PHOENIX web seam.
 * Retrieval does not authenticate claims, derive base rates, or fabricate probabilities.
 */
import type { WebRuntime, WebSearchSource } from '@phoenix-ai/dsh-web'
export interface OracleResearchSource {
  url: string
  title: string
  snippet?: string
  publishedAt?: string
}
export interface OracleResearch {
  kind: 'oracle_research'
  status: 'researched' | 'insufficient'
  question: string
  targetAt: string
  category: string
  researchedAt: string
  searches: string[]
  sources: OracleResearchSource[]
  evidenceStatus: 'search_results_unverified'
  nextStep: string
  probabilityPercent: null
  reason?: string
}
export function classifyOracleTopic(question: string): string {
  if(/lluvia|clima|temperatura|hurac[aá]n|tormenta|tiempo atmosf[eé]rico|weather|rain|storm/iu.test(question)) return 'meteorología'
  if(/paciente|enfermedad|epidemia|salud|hospital|dengue|brote|health|epidemic/iu.test(question)) return 'salud pública'
  if(/precio|bolsa|inflaci[oó]n|finanzas|mercado|econom[ií]a|cotizaci[oó]n|bitcoin|crypto/iu.test(question)) return 'economía'
  if(/partido|equipo|deporte|f[uú]tbol|b[eé]isbol|nba|mlb|goles|sports/iu.test(question)) return 'deportes'
  if(/reacci[oó]n|qu[ií]mica|mezcla|f[ií]sica|fuerza|ca[ií]da|f[oó]rmula/iu.test(question)) return 'ciencias físicas'
  return 'general'
}
function futureDate(value: string): string {
  if(!/^\d{4}-\d{2}-\d{2}T/.test(value)||!/(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value)))
    throw new Error('targetAt debe ser fecha ISO con zona horaria.')
  if(Date.parse(value)<=Date.now())throw new Error('La proyección investigada necesita un horizonte futuro.')
  return new Date(value).toISOString()
}
export async function researchOracle(
  web: Pick<WebRuntime,'search'>,
  question: string,
  targetAt: string,
  signal?: AbortSignal,
): Promise<OracleResearch> {
  if(typeof question!=='string'||question.trim().length<8||question.length>400)throw new Error('Pregunta específica entre 8 y 400 caracteres.')
  const target=futureDate(targetAt)
  const topic=classifyOracleTopic(question)
  const searches=[
    question.trim()+' datos observados pronóstico evidencia',
    question.trim()+' estudio histórico tasa base fuente oficial '+topic,
  ]
  const sources:OracleResearchSource[]=[]
  const seen=new Set<string>()
  let failure: string|undefined
  for(const query of searches){
    try {
      const result=await web.search({query,maxResults:6},signal)
      for(const item of result.sources as WebSearchSource[]){
        if(typeof item.url!=='string'||!item.url.startsWith('https://')||seen.has(item.url))continue
        seen.add(item.url)
        const entry:OracleResearchSource={url:item.url,title:(item.title||new URL(item.url).hostname).slice(0,180)}
        if(item.snippet)entry.snippet=item.snippet.slice(0,700)
        if(item.publishedAt)entry.publishedAt=item.publishedAt.slice(0,45)
        sources.push(entry)
      }
    }catch(error){failure=error instanceof Error?error.message:String(error)}
  }
  const domains=new Set(sources.map(s=>{try{return new URL(s.url).hostname}catch{return ''}}).filter(Boolean))
  const sufficient=domains.size>=2
  return {
    kind:'oracle_research',status:sufficient?'researched':'insufficient',
    question:question.trim(),targetAt:target,category:topic,researchedAt:new Date().toISOString(),
    searches,sources:sources.slice(0,12),evidenceStatus:'search_results_unverified',
    nextStep:sufficient
      ?'Abrir y contrastar fuentes primarias, extraer datos históricos anteriores al horizonte, elegir modelo por disciplina, construir evento falsable, evaluar fuera de muestra y SOLO entonces estimar un porcentaje si supera la prueba.'
      :'Ampliar fuentes verificables y reunir datos históricos. No publicar porcentaje.',
    probabilityPercent:null,
    ...sufficient?{}:{reason:failure??'No se encontraron al menos dos dominios fuente independientes.'},
  }
}

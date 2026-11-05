/** ORÁCULO publication gate: a research card is not ready until primary pages were actually fetched. */
import type { WebRuntime } from '@phoenix-ai/dsh-web'
import { relevance } from './research.ts'

export interface OracleDocumentEvidence {
  title:string
  url:string
  summary:string
  retrievedAt:string
  provenance:'retrieved_unverified'
}
export interface OraclePublication {
  kind:'oracle_evidence_report'
  status:'researched'|'insufficient'
  question:string
  targetAt:string
  documents:OracleDocumentEvidence[]
  rejected:number
  problems:string[]
  probabilityPercent:null
  evidenceStatus:'retrieved_unverified'
  nextStep:string
}
function plainText(body:string,kind:'html'|'text'):string {
  if(kind==='text')return body.replace(/\s+/gu,' ').trim().slice(0,6000)
  return body.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/giu,' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/giu,' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript\s*>/giu,' ')
    .replace(/<[^>]{0,400}>/gu,' ')
    .replace(/&(?:nbsp|amp|lt|gt|quot|#\d+);/giu,' ')
    .replace(/\s+/gu,' ').trim().slice(0,6000)
}
function knownBlocked(body:string):boolean{
  return /\b(?:captcha|just a moment|access denied|verify you are human|cloudflare challenge|robot verification)\b/iu.test(body.slice(0,1800))
}
function checkedUrl(raw:string):string {
  if(typeof raw!=='string'||raw.length>1800)throw new Error('URL de publicación fuera de rango.')
  const u=new URL(raw)
  if(u.protocol!=='https:'||u.username||u.password)throw new Error('Solo URLs HTTPS de fuentes públicas.')
  return u.toString()
}
/** Never issue the card until at least one independently retrieved page has topical text. */
export async function publishOracleResearch(web:Pick<WebRuntime,'fetch'>,args:{
  question:string
  targetAt:string
  urls:string[]
},signal?:AbortSignal):Promise<OraclePublication>{
  if(typeof args.question!=='string'||args.question.trim().length<8||args.question.length>400)
    throw new Error('La pregunta debe ser un evento verificable.')
  if(typeof args.targetAt!=='string'||!Number.isFinite(Date.parse(args.targetAt))||Date.parse(args.targetAt)<=Date.now())
    throw new Error('Horizonte de investigación debe estar en el futuro.')
  if(!Array.isArray(args.urls)||args.urls.length===0||args.urls.length>4)
    throw new Error('Proporcionar de una a cuatro URLs públicas ya identificadas.')
  const documents:OracleDocumentEvidence[]=[],problems:string[]=[],seen=new Set<string>()
  let rejected=0
  for(const raw of args.urls){
    if(signal?.aborted)throw signal.reason??new Error('Cancelado')
    let url:string
    try{url=checkedUrl(raw)}catch{rejected++;problems.push('URL inválida o no segura.');continue}
    if(seen.has(url))continue
    seen.add(url)
    try{
      const res=await web.fetch({url},signal)
      if(res.statusCode!==200||res.truncated){rejected++;problems.push('Documento no disponible o incompleto: '+new URL(url).hostname);continue}
      const finalUrl=checkedUrl(res.url)
      const text=plainText(res.body.content,res.body.kind)
      if(text.length<100||knownBlocked(text)){rejected++;problems.push('Documento sin contenido científico utilizable: '+new URL(finalUrl).hostname);continue}
      const title=(res.body.kind==='html'?res.body.content.match(/<title[^>]*>([^<]{3,180})<\/title>/iu)?.[1]:undefined)
        ??new URL(finalUrl).hostname
      const match=relevance(args.question,{url:finalUrl,title,snippet:text.slice(0,2200)})
      if(match<1){rejected++;problems.push('Documento no pertinente a pregunta o ubicación: '+new URL(finalUrl).hostname);continue}
      documents.push({title:title.slice(0,180),url:finalUrl,summary:text.slice(0,450),
        retrievedAt:new Date().toISOString(),provenance:'retrieved_unverified'})
    }catch(error){
      if(signal?.aborted)throw signal.reason??error
      rejected++;problems.push('Error al recuperar fuente: '+new URL(url).hostname)
    }
  }
  return {
    kind:'oracle_evidence_report',status:documents.length?'researched':'insufficient',
    question:args.question.trim(),targetAt:new Date(args.targetAt).toISOString(),
    documents,rejected,problems:problems.slice(0,6),probabilityPercent:null,
    evidenceStatus:'retrieved_unverified',
    nextStep:documents.length
      ?'Fuentes recuperadas, no necesariamente auténticas ni suficientes para estimar probabilidad. Extraer valores de APIs o registros y contrastar antes de pronosticar.'
      :'Continuar investigación con fuentes oficiales, APIs o web_fetch. No presentar tarjeta de investigación sin páginas recuperadas.',
  }
}

/**
 * Presentation-only adapter for legacy boxed/plain-text assistant output.
 * It does not infer sporting results, verify odds, execute code or convert
 * ordinary code samples into trusted generative-ui contracts.
 */
import css from './PlainOutputFormatter.module.css'

export type PlainOutputRow =
  | { kind:'field'; label:string; value:string }
  | { kind:'text'; value:string }

export type PlainOutputCard = {
  title:string
  sections:PlainOutputRow[][]
  simulated:boolean
  ticket:boolean
  original:string
}

export type PlainOutputSegment =
  | { kind:'markdown'; text:string }
  | { kind:'formatted'; card:PlainOutputCard }

const MAX_BODY=12_000
const MAX_SECTIONS=10
const MAX_ROWS=60
const lineBorder=/^[\s+|═─━╔╗╚╝╠╣╦╩╬┌┐└┘├┤┬┴┼┃│║╭╮╰╯]+$/u
const boxCharacter=/[═─━╔╗╚╝╠╣╦╩╬┌┐└┘├┤┬┴┼┃│║╭╮╰╯]/u
const ticketTerms=/\b(?:ticket|boleto|apuesta|cuota|mercado|selecci[oó]n|retorno potencial|ganancia potencial)\b/iu
const demoTerms=/\b(?:fictici[oa]s?|inventad[oa]s?|demostraci[oó]n|simulaci[oó]n|maqueta|no v[aá]lid[oa])\b/iu

/** Parse an unmistakably boxed text card. Keeps every data line as inert text. */
export function parsePlainOutputCard(input:string):PlainOutputCard|null {
  if(!input||input.length>MAX_BODY||!boxCharacter.test(input))return null
  const lines=input.replace(/\r\n?/gu,'\n').trim().split('\n')
  if(lines.length<4||lines.length>MAX_ROWS+MAX_SECTIONS*3)return null
  let title=''
  const sections:PlainOutputRow[][]=[]
  let rows:PlainOutputRow[]=[]
  let fieldCount=0
  let borderCount=0
  const finish=()=>{if(rows.length){sections.push(rows);rows=[]}}
  for(const line of lines){
    const original=line.trim()
    if(!original)continue
    const header=original.match(/^[╔┏┌][═─━\s]{2,}(.{3,90}?)\s*[═─━]{2,}[╗┓┐]$/u)
    if(header&&!title){title=header[1]?.trim()??'';borderCount++;continue}
    if(lineBorder.test(original)){
      borderCount++
      finish()
      continue
    }
    const content=original.replace(/^[║│┃|]\s*/u,'').replace(/\s*[║│┃|]$/u,'').trim()
    if(!content)continue
    if(content.length>450)return null
    const field=content.match(/^([^:：]{2,55})[:：]\s*(.{1,350})$/u)
    if(field){
      fieldCount++
      rows.push({ kind:'field',label:field[1]?.trim()??'',value:field[2]?.trim()??'' })
    }else rows.push({ kind:'text',value:content })
    if(rows.length+sections.reduce((sum,section)=>sum+section.length,0)>MAX_ROWS)return null
  }
  finish()
  if(borderCount<2||fieldCount<2||!sections.length||sections.length>MAX_SECTIONS)return null
  const combined=sections.flat().map(row=>row.kind==='field'?row.label+' '+row.value:row.value).join(' ')
  const ticket=ticketTerms.test(title+' '+combined)
  if(!ticket&&fieldCount<3)return null
  return {
    title:title|| (ticket?'Boleto de análisis':'Resumen estructurado'),
    sections,simulated:demoTerms.test(title+' '+combined),ticket,original:input,
  }
}

function appendMarkdown(out:PlainOutputSegment[],text:string):void{
  if(!text)return
  const last=out.at(-1)
  if(last?.kind==='markdown')last.text+=text
  else out.push({ kind:'markdown',text })
}

/** Convert complete plaintext fences; leave code, prose and tables unchanged. */
export function splitPlainOutputText(text:string):PlainOutputSegment[]{
  const output:PlainOutputSegment[]=[]
  const fence=/^\x60{3}[ \t]*(?:text|plaintext|txt|plain)[ \t]*\r?\n([\s\S]*?)^\x60{3}[ \t]*$/gim
  let cursor=0
  let transformed=0
  for(const match of text.matchAll(fence)){
    const start=match.index??0
    const body=match[1]??''
    const card=transformed<6?parsePlainOutputCard(body):null
    if(!card)continue
    appendMarkdown(output,text.slice(cursor,start))
    output.push({ kind:'formatted',card })
    cursor=start+match[0].length
    transformed++
  }
  const tail=text.slice(cursor)
  if(transformed===0 && /^\s*[╔┏┌]/u.test(tail) && !tail.includes('\x60\x60\x60')){
    const card=parsePlainOutputCard(tail)
    if(card)return [{ kind:'formatted',card }]
  }
  appendMarkdown(output,tail)
  return output
}

/** Phoenix-native display for plaintext legacy tickets and boxed summaries. */
export function PlainOutputFormatter({ card }:{ card:PlainOutputCard }){
  return <section className={css.card} data-phoenix-formatted-output={card.ticket?'ticket':'panel'}
    aria-label={card.ticket?'Boleto de texto formateado':'Panel de texto formateado'}>
    <header className={css.header}>
      <span className={css.eyebrow}>PHOENIX / {card.ticket?'BOLETO':'PANEL'}</span>
      <div className={css.titleRow}>
        <h3>{card.title}</h3>
        {card.simulated&&<span className={css.pill}>DEMOSTRACIÓN</span>}
      </div>
    </header>
    <div className={css.sections}>{card.sections.map((section,index)=>
      <div className={css.section} key={index}>
        {section.map((row,i)=>row.kind==='field'
          ? <dl className={css.field} key={i}><dt>{row.label}</dt><dd>{row.value}</dd></dl>
          : <p className={i===0?css.sectionLead:css.plainLine} key={i}>{row.value}</p>)}
      </div>)}</div>
    <footer className={css.footer}>
      <span>{card.simulated?'Contenido ficticio o de demostración · No válido para apostar':
        'Transcripción visual · Los datos y cuotas no han sido verificados por este formateador'}</span>
      <details className={css.details}>
        <summary>Ver texto original</summary>
        <pre>{card.original}</pre>
      </details>
    </footer>
  </section>
}

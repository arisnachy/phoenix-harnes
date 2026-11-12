/** Daily sports publication: deterministic, side-effect-free report formatting.
 * The report is a research product, not an accepted wager or calibrated forecast.
 */
const clean=(value,max=320)=>String(value??'').replace(/[\u0000-\u001f]/gu,' ').trim().slice(0,max)
const list=value=>Array.isArray(value)?value:[]
const validDay=value=>/^\d{4}-\d{2}-\d{2}$/u.test(value)&&
  Number.isFinite(Date.parse(value+'T00:00:00Z'))&&
  new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value
export function formatDailyReport(ticket,{date,slot='morning',checkedAt,goal=5,error=null}={}){
  if(!validDay(date)||!['morning','evening','manual'].includes(slot)||
    !Number.isInteger(goal)||goal<5||goal>6)throw Error('Parámetros inválidos de publicación')
  const props=ticket?.card?.props??{}
  const tracking=list(ticket?.trackingEvents)
  const legs=list(props.legs).slice(0,goal).map((row,index)=>{
    const leg=row&&typeof row==='object'?row:{}
    const event=tracking[index]??{}
    const raw=Number(leg.price)
    return{
      eventId:clean(leg.eventId??event.eventId,28),
      sport:clean(leg.sport??event.sport,40),
      league:clean(leg.league??event.league,90),
      home:clean(leg.homeTeam??leg.home,100),
      away:clean(leg.awayTeam??leg.away,100),
      selection:clean(leg.selection,130),
      bookmaker:clean(leg.bookmaker,90),
      price:Number.isFinite(raw)&&raw>1&&raw<1000?raw:null,
      probabilitySource:clean(leg.legProbabilitySource,80),
      winProbabilityPercent:Number.isFinite(leg.legWinProbabilityPercent)?
        leg.legWinProbabilityPercent:null,
      researchStatus:clean(leg.researchStatus??'conditional',50),
      rationale:clean(leg.rationale,470),
      risks:list(leg.riskNotes).slice(0,5).map(x=>clean(x,170)),
    }
  })
  const discovered=Number(ticket?.discoveredEvents??ticket?.discoveryAudit?.discoveredEvents??0)
  const quotes=Number(ticket?.quotedLegs??0)
  const priced=Boolean(ticket?.priced&&ticket?.complete&&quotes===goal)
  const failures=list(ticket?.sourceAudit).map(source=>({
    name:clean(source.source,90),status:clean(source.status,40),
    offers:Number(source.offers??0),
  }))
  const audit=ticket?.discoveryAudit??{}
  const uncovered=list(audit.scanCoverage).filter(x=>x.status==='unavailable')
    .slice(0,16).map(x=>({sport:clean(x.sport,40),league:clean(x.league,80),
      reason:clean(x.reason,160)}))
  const previews=list(props.pricePreview).slice(0,6).map(item=>({
    eventId:clean(item.eventId,28),sport:clean(item.sport,40),
    league:clean(item.league,90),home:clean(item.home,100),
    away:clean(item.away,100),options:list(item.options).slice(0,6).map(q=>({
      bookmaker:clean(q.bookmaker,90),selection:clean(q.selection,100),
      market:clean(q.market,45),price:Number(q.price),
      observedAt:clean(q.observedAt,40),
    })),
  }))
  return{
    schema:1,date,slot,checkedAt:clean(checkedAt??new Date().toISOString(),40),
    goal,engine:'PHOENIX Sports Intelligence',
    status:error?'error':priced?'priced-research-ticket':'partial-research-report',
    published:true,placed:false,approvedForBetting:false,
    discoveredEvents:Number.isFinite(discovered)?discovered:0,
    researchedEvents:Number(ticket?.verifiedEvents??0),
    quotedLegs:Number.isFinite(quotes)?quotes:0,
    complete:priced,conditional:Boolean(ticket?.conditional),
    bookmaker:priced?clean(props.bookmaker??legs[0]?.bookmaker,90):null,
    legs,marketPreviews:previews,
    sourceAudit:failures,unavailableLeagues:uncovered,
    modelStatus:'unvalidated-unless-independently-supported',
    explanation:clean(ticket?.explanation??error??'Sin respuesta verificable',1100),
    warning:'Entrega diaria obligatoria de informe, NO obligación de completar cinco apuestas. Una cotización ESPN observada no garantiza aceptación en la casa. Ningún porcentaje de mercado representa probabilidad calibrada.',
  }
}
export function dailyReportMarkdown(report){
  const rows=[
    '# PHOENIX Sports Intelligence · '+report.date,
    '',
    'Edición: '+report.slot+' · Consultado: '+report.checkedAt,
    '',
    '**Estado:** '+report.status+' · Partidos: '+report.discoveredEvents+
      ' · Investigados: '+report.researchedEvents+' · Cotizados: '+
      report.quotedLegs+'/'+report.goal,
    '',
    '**Aviso:** '+report.warning,'',
  ]
  for(const [index,leg] of report.legs.entries()){
    rows.push('## '+(index+1)+'. '+leg.away+' vs '+leg.home,
      'Disciplina: '+leg.sport+' · Liga: '+leg.league+
      ' · ID ESPN: '+leg.eventId,
      'Selección: '+(leg.selection||'No cotizada')+' · Casa: '+
      (leg.bookmaker||'No identificada')+' · Cuota observada: '+
      (leg.price??'No disponible'),
      'Estado: '+leg.researchStatus+' · Origen de porcentaje: '+
      (leg.probabilitySource||'No calibrado'),
      leg.rationale||'Sin análisis suficiente para recomendar',...leg.risks.map(x=>'Riesgo: '+x),'')
  }
  if(!report.legs.length)rows.push('No existen selecciones justificadas por el motor. La cartelera y los mercados siguen auditados.','')
  if(report.marketPreviews.length){
    rows.push('## Partidos con observaciones de precio no aprobadas','')
    for(const match of report.marketPreviews)rows.push(
      match.away+' vs '+match.home+' · '+match.eventId+' · '+
      match.options.map(q=>q.bookmaker+' '+q.selection+' '+q.price).join('; '))
    rows.push('')
  }
  rows.push('## Fuentes','')
  for(const row of report.sourceAudit)rows.push('- '+row.name+' · '+row.status+' · '+row.offers+' observaciones')
  rows.push('','## Limitaciones','',report.explanation,'',
    'Este documento no certifica ejecución de apuestas ni rentabilidad.','')
  return rows.join('\n')
}

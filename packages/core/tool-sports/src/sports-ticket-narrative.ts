/** Evidence-bound, per-leg explanation for Kira and the native ticket UI.
 * Pure mapping: never fetches, invents a referee edge, copies a tipster pick,
 * or promotes an exploratory/model-free percentage into betting confidence.
 */
import type {DeepSportsContext} from './sports-deep-context.ts'
import type {SpecialistGate} from './ticket-specialist-gate.ts'

export type TicketNarrativeEvent={
  eventId:string;sport:string;league:string;home:string;away:string;
  kickoff:string;pick:'home'|'away'|'draw'
}
export type TicketEvidenceState='verified'|'partial'|'missing'
export type TicketNewsItem={
  headline:string;publishedAt:string|null;publisher:string;
  articleUrl:string|null;imageUrl:string|null
}
export type TicketNarrative={
  eventId:string;selected:string;title:string;status:'documented'|'conditional';
  selectionWhy:string;favorable:string[];contradictions:string[];
  specialistEvidence:string[];criticalPending:string[];
  news:TicketNewsItem[];
  externalOpinions:Array<{publisher:string;headline:string;publishedAt:string|null;
    discoveryUrl:string;status:'indexed-headline-only'}>;
  externalModel:{provider:string;status:'support'|'contradiction'|'unavailable';
    selection:string|null;modelProbabilityPercent:number|null;updatedAt:string|null;
    sourceUrl:string|null};
  venue:{name:string|null;city:string|null;venueSplit:'verified'|'not-verified';
    games:number;wins:number;losses:number};
  directOpponentHistory:{status:'verified'|'not-verified';note:string;
    games:number;wins:number;losses:number};
  referee:{names:string[];bias:'not-assessed';note:string};
  weather:{status:'verified'|'unavailable'|'not-applicable';description:string;source:string|null};
  imagery:{imageUrl:string|null;attribution:string|null;articleUrl:string|null};
  percentage:{value:number|null;kind:'exploratory-recent-form'|'market-no-vig'|'unavailable';warning:string};
  sources:Array<{name:string;status:TicketEvidenceState;url:string|null}>;
  explanationForChat:string
}
const clean=(x:unknown,max=300):string=>typeof x==='string'
  ?x.replace(/[\u0000-\u001f]/gu,' ').trim().slice(0,max):''
const https=(x:unknown,hosts:readonly string[]):string|null=>{
  if(typeof x!=='string')return null
  try{
    const u=new URL(x)
    if(u.protocol!=='https:'||u.username||u.password)return null
    const host=u.hostname.toLowerCase()
    if(!hosts.some(h=>host===h||host.endsWith('.'+h)))return null
    return u.toString()
  }catch{return null}
}
const articleHosts=['espn.com','espn.com.do']
const imageHosts=['espncdn.com','espn.com','espn.com.do']
const uniq=(items:string[],max=8)=>[...new Set(items.filter(Boolean))].slice(0,max)
export function composeTicketLegNarrative(
  event:TicketNarrativeEvent,
  leg:Readonly<Record<string,unknown>>,
  context?:DeepSportsContext,
  specialist?:SpecialistGate,
):TicketNarrative{
  const deep=context?.eventId===event.eventId&&context.sport===event.sport&&
    context.league===event.league?context:undefined
  const audit=specialist?.eventId===event.eventId&&specialist.sport===event.sport&&
    specialist.league===event.league?specialist:undefined
  const selected=event.pick==='home'?event.home:event.pick==='away'?event.away:'Empate'
  const title=event.away+' vs '+event.home
  const selectionWhy=clean(leg.rationale,650)||
    'Selección provisional: todavía no se verificó un argumento deportivo individual.'
  const criticalPending=uniq((audit?.checklist?.criticalPending??[])
    .map(x=>clean(x,180)),12)
  const specialistEvidence=uniq((audit?.verifiedSteps??[])
    .map(x=>clean(x,180)),12)
  const contradictions=uniq([
    ...criticalPending,
    ...(audit?.sourceChecks??[]).filter(x=>x.status==='conflict')
      .map(x=>'Conflicto entre proveedores: '+clean(x.detail,120)),
    ...(audit?.pendingSteps??[]).slice(0,5).map(x=>clean(x,180)),
  ],12)
  const news=(deep?.headlines??[]).slice(0,5).map(x=>({
    headline:clean(x.headline,180),
    publishedAt:Number.isFinite(Date.parse(x.published))?new Date(x.published).toISOString():null,
    publisher:x.source,
    articleUrl:https(x.articleUrl,articleHosts),
    imageUrl:https(x.imageUrl,imageHosts),
  })).filter(x=>x.headline)
  const storyWithImage=news.find(n=>n.imageUrl&&n.articleUrl)
  const image=storyWithImage?.imageUrl??null
  const historical=leg.historicalContext&&typeof leg.historicalContext==='object'&&
    !Array.isArray(leg.historicalContext)?leg.historicalContext as Record<string,unknown>:{}
  const size=(key:string)=>typeof historical[key]==='number'&&
    Number.isInteger(historical[key])&&Number(historical[key])>=0&&
    Number(historical[key])<=10?Number(historical[key]):0
  const opponentGames=size('opponentGames'),opponentWins=size('opponentWins'),
    opponentLosses=size('opponentLosses')
  const venueGames=size('venueGames'),venueWins=size('venueWins'),
    venueLosses=size('venueLosses')
  const venueName=clean(deep?.venue?.name,120)||clean(historical.venueName,120)||null
  const venueCity=clean(deep?.venue?.city,110)||null
  const officials=(deep?.officials??[]).map(x=>clean(x.name,100))
  const climate=deep?.weather
  const weatherStatus=climate?.status==='verified'?'verified' as const:
    climate?.status==='not-applicable'?'not-applicable' as const:'unavailable' as const
  const weatherDescription=weatherStatus==='verified'?
    clean(climate?.description,230):
    weatherStatus==='not-applicable'?'Partido bajo techo o meteorología sin efecto directo verificado.':
      'Sin pronóstico meteorológico vinculado a coordenadas comprobadas del recinto.'
  const rawPercent=leg.legWinProbabilityPercent
  const percent=typeof rawPercent==='number'&&Number.isFinite(rawPercent)&&
    rawPercent>=0&&rawPercent<=100?rawPercent:null
  const stated=leg.legProbabilitySource
  const kind=percent!==null&&stated==='bookmaker-market-no-vig'?'market-no-vig':
    percent!==null&&stated==='exploratory-recent-form'?'exploratory-recent-form':'unavailable'
  const percentage={
    value:kind==='unavailable'?null:percent,
    kind,
    warning:kind==='market-no-vig'?'Probabilidad implícita sin margen de la casa; no es pronóstico calibrado.':
      kind==='exploratory-recent-form'?'Estimación exploratoria basada en resultados previos; no calibrada ni validada contra mercado.':
        'Sin porcentaje individual verificable; no inferirlo de la cuota o de un consenso.',
  } as TicketNarrative['percentage']
  const favorable=uniq([
    ...(clean(leg.rationale,650)?['Hipótesis deportiva: '+clean(leg.rationale,320)]:[]),
    ...specialistEvidence.slice(0,3).map(x=>'Dato investigado: '+x),
  ],5)
  const sources:TicketNarrative['sources']=[
    {name:'ESPN Site/Core: resumen de evento',
      status:deep?.sources.some(x=>x.name==='ESPN match summary'&&x.status==='verified')
        ?'verified':'missing',
      url:'https://site.api.espn.com/apis/site/v2/sports/'+event.sport+'/'+event.league+
        '/summary?event='+encodeURIComponent(event.eventId)},
    ...news.filter(x=>x.articleUrl).slice(0,3).map(x=>({
      name:clean(x.publisher,60)+': '+x.headline.slice(0,65),
      status:'partial' as const,url:x.articleUrl,
    })),
    ...((audit?.sourceChecks??[]).slice(0,5).map(x=>({
      name:clean(x.provider,60),
      status:x.status==='verified'?'verified' as const:
        x.status==='partial'?'partial' as const:'missing' as const,
      url:https(x.url,[ 'espn.com','nhl.com','mlb.com','thesportsdb.com',
        'openligadb.de','football-data.org','api-sports.io','github.com',
        'statsapi.mlb.com','nhle.com'])??null,
    }))),
  ]
  const documented=audit?.checklist?.complete===true&&audit.status==='researched'&&
    contradictions.length===0
  const chat=[
    'Pata '+title+': '+selected+'.',
    'Por qué se eligió: '+selectionWhy,
    favorable.length?'Evidencia favorable: '+favorable.slice(1).join('; ')+'.':'',
    news.length?'Noticias relacionadas: '+news.slice(0,3).map(x=>
      x.headline+(x.publishedAt?' · '+x.publishedAt.slice(0,16)+' UTC':' · sin fecha comprobable')+
      (x.articleUrl?' · '+x.articleUrl:' · enlace no verificable')).join('; ')+
      '. Estos titulares NO confirman lesiones ni picks.':'Noticias relevantes: sin artículos individualizados comprobados.',
    venueName?'Sede identificada: '+venueName+(venueCity?' ('+venueCity+')':'')+'.':
      'Sede sin nombre comprobado.',
    venueGames>0?'En ese estadio, '+venueGames+' partido(s) previos observados en la muestra: '+
      venueWins+' victorias y '+venueLosses+' derrotas; historial parcial, no ventaja calculada.':
      'Rendimiento en estadio exacto: no verificado.',
    'Árbitro: '+(officials.length?officials.join(', '):'asignación sin verificar')+
      '. Ningún sesgo hacia un equipo queda demostrado por el nombre del oficial.',
    'Clima: '+weatherDescription,
    opponentGames>0?'Historial ante este oponente en la muestra reciente: '+
      opponentGames+' enfrentamiento(s), '+opponentWins+' victoria(s), '+
      opponentLosses+' derrota(s); muestra pequeña, no predicción.':
      'H2H reciente contra el oponente: sin enfrentamientos verificables en la muestra disponible.',
    'Cruce individual jugador/portero/pitcher: pendiente de evidencia identificada por nombre e ID.',
    'Porcentaje: '+(percentage.value===null?'no disponible':percentage.value.toFixed(1)+'%')+
      '. '+percentage.warning,
    contradictions.length?'Advertencias: '+contradictions.slice(0,4).join('; ')+'.':
      'No se detectaron conflictos en el expediente consultado; no equivale a una apuesta segura.',
    'Estado: '+(documented?'expediente especializado documentado.':
      'condicional; confirmar indicadores pendientes.'),
  ].filter(Boolean).join('\n')
  return{
    eventId:event.eventId,selected,title,status:documented?'documented':'conditional',
    selectionWhy,favorable,contradictions,specialistEvidence,criticalPending,news,
    externalOpinions:[],externalModel:{provider:'Bet Better',status:'unavailable',
      selection:null,modelProbabilityPercent:null,updatedAt:null,sourceUrl:null},
    venue:{name:venueName,city:venueCity,venueSplit:venueGames>0?'verified':'not-verified',
      games:venueGames,wins:venueWins,losses:venueLosses},
    directOpponentHistory:{status:opponentGames>0?'verified':'not-verified',
      games:opponentGames,wins:opponentWins,losses:opponentLosses,
      note:opponentGames>0?'Registros ESPN observados entre los últimos encuentros; no extrapolar al duelo individual.':
        'No se debe extrapolar el H2H histórico a jugadores o porteros actuales sin IDs, fecha y muestra.'},
    referee:{names:uniq(officials,6),bias:'not-assessed',
      note:'Penalizaciones, tarjetas y faltas requieren tasas ajustadas y datos anteriores al encuentro; jamás inferir favoritismo de un registro bruto.'},
    weather:{status:weatherStatus,description:weatherDescription,
      source:weatherStatus==='verified'?'Open-Meteo Forecast API':null},
    imagery:{imageUrl:image,attribution:image?'ESPN News':null,
      articleUrl:storyWithImage?.articleUrl??null},
    percentage,sources,explanationForChat:chat,
  }
}

/** Promote only verified specialist findings; a quote never repairs missing data. */
export function enrichSpecialistNarrative(
  prior:TicketNarrative|null|undefined,
  specialist?:SpecialistGate,
  marketNoVigPercent?:number|null,
  externalOpinion?:{status:'support'|'contradiction'|'unavailable';prediction?:{
    selection:string;modelProbabilityPct:number;updatedAt:string;provider:string;
  }|null},
):TicketNarrative|null{
  if(!prior)return null
  const check=specialist?.eventId===prior.eventId?specialist:undefined
  const evidence=uniq([...(prior.specialistEvidence??[]),
    ...(check?.verifiedSteps??[]).map(x=>clean(x,180))],12)
  const pending=uniq([...(check?.checklist?.criticalPending??[]),
    ...(check?.pendingSteps??[])].map(x=>clean(x,180)),12)
  const conflicts=(check?.sourceChecks??[]).filter(x=>x.status==='conflict')
    .map(x=>'Conflicto de fuente: '+clean(x.detail,140))
  const contradictions=uniq([...prior.contradictions,...pending,...conflicts],12)
  const hasPrice=typeof marketNoVigPercent==='number'&&
    Number.isFinite(marketNoVigPercent)&&marketNoVigPercent>=0&&marketNoVigPercent<=100
  const percentage:TicketNarrative['percentage']=hasPrice?{
    value:marketNoVigPercent as number,kind:'market-no-vig' as const,
    warning:'Probabilidad implícita SIN margen de la casa: referencia de mercado, no probabilidad de acierto calibrada.',
  }:prior.percentage
  const documented=check?.status==='researched'&&check.checklist?.complete===true&&
    contradictions.length===0
  const prediction=externalOpinion?.prediction
  const modelPercent=prediction&&Number.isFinite(prediction.modelProbabilityPct)&&
    prediction.modelProbabilityPct>=0&&prediction.modelProbabilityPct<=100?
    prediction.modelProbabilityPct:null
  const externalModel=prediction?{provider:'Bet Better',status:externalOpinion?.status??'unavailable',
    selection:clean(prediction.selection,100)||null,modelProbabilityPercent:modelPercent,
    updatedAt:Number.isFinite(Date.parse(prediction.updatedAt))?prediction.updatedAt:null,
    sourceUrl:'https://betbetter.world'} as TicketNarrative['externalModel']:
    prior.externalModel
  const explanationForChat=prior.explanationForChat
    .replace(/^Porcentaje: .*$/mu,'Porcentaje: '+
      (percentage.value===null?'no disponible':percentage.value.toFixed(1)+'%')+
      '. '+percentage.warning)
    .replace(/^Estado: .*$/mu,'Estado: '+(documented?
      'investigación especializada documentada.':
      'condicional; indicadores críticos pendientes o sin comprobar.'))+
    (evidence.length?'\nEspecialista: '+evidence.slice(0,4).join('; ')+'.':'')+
    (pending.length?'\nPendientes: '+pending.slice(0,5).join('; ')+'.':'')+
    (prediction?'\nModelo externo independiente Bet Better: pronostica '+
      clean(prediction.selection,100)+', '+(modelPercent===null?'porcentaje no verificado':
      modelPercent.toFixed(1)+'%')+', '+(externalOpinion?.status??'unavailable')+
      '. Fuente https://betbetter.world, actualizado '+clean(prediction.updatedAt,45)+
      '. Es segunda opinión con licencia CC BY, no precio de bookmaker ni certeza.':
      '\nModelo externo: sin predicción comprobada para este evento.');
  return {...prior,status:documented?'documented':'conditional',
    specialistEvidence:evidence,criticalPending:pending,contradictions,percentage,
    externalModel,
    favorable:uniq([...prior.favorable,...evidence.slice(0,2).map(x=>'Datos especialistas: '+x)],6),
    explanationForChat}
}

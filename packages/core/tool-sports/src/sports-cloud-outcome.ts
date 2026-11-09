/** Official-score outcome monitor shared between the local tool and a cloud runner.
 * The result is about sporting outcomes, NEVER bookmaker acceptance or payout.
 * A missing period, rule or box score must remain unresolved.
 */
export type CloudSport='basketball'|'hockey'|'football'|'baseball'|'soccer'|'tennis'
export type CloudLeg={
  sport:CloudSport;league:string;eventId:string;date:string
  market:'winner'|'double_chance'|'spread'|'total'
  selection:'home'|'away'|'1X'|'X2'|'over'|'under'
  line?:number
}
export type CloudTicket={
  version:1;reference:string;kind:'research'|'receipt';createdAt:string
  legs:CloudLeg[]
}
export type CloudGrade={
  eventId:string;result:'won'|'lost'|'push'|'pending'|'unverifiable'
  score:string|null;reason:string
}
const obj=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==='object'&&
  !Array.isArray(v)?v as Record<string,unknown>:{}
const arr=(v:unknown):unknown[]=>Array.isArray(v)?v:[]
const num=(v:unknown):number|null=>{
  if(typeof v!=='string'&&typeof v!=='number')return null
  if(!/^\d{1,3}$/u.test(String(v)))return null
  return Number(v)
}
const name=(v:unknown):string=>typeof v==='string'?v:''
const statusText=(event:Record<string,unknown>)=>{
  const type=obj(obj(event.status).type)
  return [name(type.name),name(type.detail),name(type.description),
    name(obj(event.status).displayClock)].join(' ').toLowerCase()
}
const innings=(row:Record<string,unknown>,needed:number)=>{
  const rows=arr(row.linescores)
  return rows.length>=needed&&rows.slice(0,needed).every(x=>
    num(obj(x).value??obj(x).displayValue)!==null)
}
export function validateCloudTicket(value:unknown):CloudTicket{
  const ticket=obj(value),legs=arr(ticket.legs)
  if(ticket.version!==1||!['research','receipt'].includes(name(ticket.kind))||
    !/^[A-Za-z0-9-]{1,50}$/u.test(name(ticket.reference))||
    !Number.isFinite(Date.parse(name(ticket.createdAt)))||
    legs.length<1||legs.length>12)throw Error('Registro de ticket remoto inválido')
  const unique=new Set<string>()
  for(const raw of legs){
    const leg=obj(raw),sport=name(leg.sport),league=name(leg.league),id=name(leg.eventId)
    const day=name(leg.date),market=name(leg.market),pick=name(leg.selection)
    if(!['basketball','hockey','football','baseball','soccer','tennis'].includes(sport)||
      !/^[a-z0-9][a-z0-9._-]{0,79}$/u.test(league)||!/^\d{1,20}$/u.test(id)||
      !/^\d{4}-\d{2}-\d{2}$/u.test(day)||
      !Number.isFinite(Date.parse(day+'T00:00:00Z'))||
      new Date(day+'T00:00:00Z').toISOString().slice(0,10)!==day||
      !['winner','double_chance','spread','total'].includes(market)||
      !['home','away','1X','X2','over','under'].includes(pick)||
      (market==='winner'&&!['home','away'].includes(pick))||
      (market==='double_chance'&&(sport!=='soccer'||!['1X','X2'].includes(pick)))||
      (market==='spread'&&!['home','away'].includes(pick))||
      (market==='total'&&!['over','under'].includes(pick))||
      (['total','spread'].includes(market)&&
        (typeof leg.line!=='number'||!Number.isFinite(leg.line)||
          Math.abs(leg.line)>10000))||
      !['total','spread'].includes(market)&&leg.line!==undefined)
      throw Error('Pata no verificable para seguimiento remoto')
    const key=sport+'|'+league+'|'+id
    if(unique.has(key))throw Error('Evento duplicado en el ticket')
    unique.add(key)
  }
  return value as CloudTicket
}
export function gradeCloudLeg(leg:CloudLeg,event:unknown):CloudGrade{
  const e=obj(event),eventId=name(e.id)
  const common={eventId:leg.eventId,score:null as string|null}
  const unknown=(result:CloudGrade['result'],reason:string):CloudGrade=>({
    ...common,result,reason})
  if(eventId!==leg.eventId)return unknown('unverifiable','ID ESPN no coincidente')
  if(name(obj(obj(e.status).type).state)!=='post')
    return unknown('pending','Evento todavía no finalizado oficialmente')
  const comp=obj(arr(e.competitions)[0]),participants=arr(comp.competitors)
  const h=participants.find(x=>obj(x).homeAway==='home')
  const a=participants.find(x=>obj(x).homeAway==='away')
  if(!h||!a)return unknown('unverifiable','Faltan los dos participantes')
  const home=obj(h),away=obj(a)
  const scoreHome=num(home.score),scoreAway=num(away.score)
  const score=scoreHome!==null&&scoreAway!==null?
    scoreAway+'-'+scoreHome:null
  const result=(won:boolean):CloudGrade=>({
    eventId:leg.eventId,score,result:won?'won':'lost',
    reason:'Resultado deportivo oficial provisional; verificar reglas y pago de casa'})
  const flags=statusText(e)
  if(leg.sport==='tennis'){
    if(/retir|walkover|forfeit|suspend|cancel/u.test(flags))
      return unknown('unverifiable','Retiro o walkover exige reglas de casa')
    if(leg.market!=='winner')return unknown('unverifiable','Mercado de tenis no compatible con marcador simple')
    if(typeof home.winner==='boolean'&&typeof away.winner==='boolean'&&
      home.winner!==away.winner)
      return result((leg.selection==='home'?home:away).winner===true)
    return unknown('unverifiable','Ganador oficial de tenis no confirmado por competidor')
  }
  if(scoreHome===null||scoreAway===null)
    return unknown('unverifiable','Marcador final incompleto')
  if(leg.sport==='soccer'){
    // ESPN may display a 120-minute score after knockouts; do not settle
    // 90-minute 1X2 or double-chance from that score.
    if(/penalt|aet|extra.time|after.extra|120|pen\./u.test(flags))
      return unknown('unverifiable','Resultado de 90 minutos separado de prórroga/penales no verificado')
  }
  if(leg.sport==='baseball'){
    const loser=scoreHome<scoreAway?home:scoreAway<scoreHome?away:null
    const minInnings=leg.market==='winner'?5:9
    if(loser?!innings(loser,minInnings):
      !innings(home,minInnings)||!innings(away,minInnings))
      return unknown('unverifiable','MLB: innings suficientes no verificados para reglas de casa')
  }
  const difference=scoreHome-scoreAway,points=scoreHome+scoreAway
  if(leg.market==='winner'){
    if(difference===0){
      return leg.sport==='soccer'?
        unknown('unverifiable','Empate no cubre ganador 1X2; verificar mercado concreto'):
        {...common,score,result:'push',reason:'Empate final: validar reglas de prórroga'}
    }
    return result(leg.selection==='home'?difference>0:difference<0)
  }
  if(leg.market==='double_chance'){
    if(leg.sport!=='soccer')
      return unknown('unverifiable','Solo admite fútbol soccer a 90 minutos')
    return result(leg.selection==='1X'?difference>=0:difference<=0)
  }
  const gap=leg.market==='spread'?
    (leg.selection==='home'?difference:-difference)+(leg.line??0):
    leg.selection==='over'?points-(leg.line??0):(leg.line??0)-points
  return Number.isFinite(gap)?{
    ...common,score,result:gap>0?'won':gap<0?'lost':'push',
    reason:'Línea aritmética sobre marcador final; liquidación de casa NO confirmada',
  }:unknown('unverifiable','Línea inválida')
}
export function summarizeCloudTicket(grades:readonly CloudGrade[]){
  const unresolved=grades.some(x=>x.result==='pending'||x.result==='unverifiable')
  const status=unresolved?'pending':grades.some(x=>x.result==='lost')?'lost':
    grades.length&&grades.every(x=>x.result==='push')?'refund':'won'
  return{status,terminal:!unresolved&&grades.length>0,
    won:grades.filter(x=>x.result==='won').length,
    lost:grades.filter(x=>x.result==='lost').length,
    push:grades.filter(x=>x.result==='push').length,
    pending:grades.filter(x=>x.result==='pending').length,
    unverifiable:grades.filter(x=>x.result==='unverifiable').length,
    warning:'Clasificación deportiva provisional. Nunca equivale a pago, aceptación o liquidación de la banca.'}
}

/** Human tool adapters for an opt-in remote, private-by-encryption monitor.
 * Pure conversion functions keep bookmaker rules distinct from research picks.
 */
import {randomUUID} from 'node:crypto'
import {validateCloudTicket,type CloudTicket,type CloudLeg,type CloudSport}
  from './sports-cloud-outcome.ts'
import {enrollCloudTicket,type CloudEnrollment} from './sports-cloud-ticket.ts'
type Fixture={sport:string;league:string;eventId:string;date:string;
  pick:'home'|'away'|'draw';kickoff?:string}
type ReceiptFixture={sport:string;league:string;eventId:string;date:string;
  goal:{market:string;side:string;line?:number}}
const supported=(name:string):name is CloudSport=>
  ['basketball','football','baseball','hockey','soccer','tennis'].includes(name)
export function cloudForecastTicket(fixtures:readonly Fixture[],
  marketPreference:'winner'|'double_chance',priced:boolean,
  now=Date.now()):CloudTicket{
  const legs:CloudLeg[]=fixtures.map(x=>{
    if(!supported(x.sport))throw Error('Deporte sin clasificador cloud')
    const double=marketPreference==='double_chance'&&priced&&x.sport==='soccer'
    const draw=x.pick==='draw'
    return{sport:x.sport,league:x.league,eventId:x.eventId,date:x.date,
      market:draw?'three-way':double?'double_chance':'winner',
      selection:draw?'draw':double?(x.pick==='home'?'1X':'X2'):x.pick}
  })
  return validateCloudTicket({version:1,kind:'research',
    reference:'PHX-'+randomUUID(),createdAt:new Date(now).toISOString(),legs})
}
export function cloudReceiptTicket(reference:string,fixtures:readonly ReceiptFixture[],
  now=Date.now()):CloudTicket{
  const legs:CloudLeg[]=fixtures.map(x=>{
    if(!supported(x.sport))throw Error('Deporte del recibo no admite monitor cloud')
    const market=x.goal.market==='moneyline'?'winner':x.goal.market
    if(!['winner','three-way','spread','total'].includes(market)||
      !['home','away','draw','over','under'].includes(x.goal.side))
      throw Error('Mercado del recibo requiere validador de liquidación adicional')
    return{sport:x.sport,league:x.league,eventId:x.eventId,date:x.date,
      market:market as CloudLeg['market'],
      selection:x.goal.side as CloudLeg['selection'],
      ...(x.goal.line===undefined?{}:{line:x.goal.line})}
  })
  return validateCloudTicket({version:1,kind:'receipt',
    reference,createdAt:new Date(now).toISOString(),legs})
}
export async function registerCloudForecast(
  fixtures:readonly Fixture[],marketPreference:'winner'|'double_chance',
  priced:boolean,env:NodeJS.ProcessEnv,transport:typeof fetch=fetch,
):Promise<CloudEnrollment>{
  if(env.PHOENIX_SPORTS_CLOUD_TRACKING_ENABLED!=='1')
    return{status:'disabled',issueNumber:null,
      reason:'Seguimiento fuera de la PC no habilitado en el servidor de PHOENIX.'}
  try{return await enrollCloudTicket(cloudForecastTicket(fixtures,
    marketPreference,priced),env,transport)}
  catch{return{status:'error',issueNumber:null,
    reason:'No se pudo identificar todas las patas para seguimiento cloud. Ningún ticket se publicó.'}}
}
export async function registerCloudReceipt(reference:string,
  fixtures:readonly ReceiptFixture[],env:NodeJS.ProcessEnv,
  transport:typeof fetch=fetch,
):Promise<CloudEnrollment>{
  if(env.PHOENIX_SPORTS_CLOUD_TRACKING_ENABLED!=='1')
    return{status:'disabled',issueNumber:null,
      reason:'Seguimiento fuera de la PC no habilitado en el servidor de PHOENIX.'}
  try{return await enrollCloudTicket(cloudReceiptTicket(reference,fixtures),
    env,transport)}
  catch{return{status:'error',issueNumber:null,
    reason:'El recibo contiene mercados sin evaluación remota segura; no se registró parcialmente.'}}
}

/** Daily market shortlist tickets have exact research-priced side and line. */
export async function registerCloudMarkets(legs:readonly CloudLeg[],
  env:NodeJS.ProcessEnv,transport:typeof fetch=fetch):Promise<CloudEnrollment>{
  if(env.PHOENIX_SPORTS_CLOUD_TRACKING_ENABLED!=='1')
    return{status:'disabled',issueNumber:null,
      reason:'Seguimiento cloud desactivado; ticket permanece solo en el chat.'}
  try{
    const ticket=validateCloudTicket({version:1,kind:'research',
      reference:'PHX-'+randomUUID(),createdAt:new Date().toISOString(),legs:[...legs]})
    return await enrollCloudTicket(ticket,env,transport)
  }catch{
    return{status:'error',issueNumber:null,
      reason:'Un mercado no tiene identidad, período o línea verificables; seguimiento no registrado.'}
  }
}

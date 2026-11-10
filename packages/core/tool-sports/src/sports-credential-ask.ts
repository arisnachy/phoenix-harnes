/** Persistent, non-secret consent preferences for OPTIONAL provider key questions.
 * This module never receives, stores or transmits API key values.
 */
import {mkdir,readFile,rename,writeFile} from 'node:fs/promises'
import {homedir} from 'node:os'
import {join,resolve} from 'node:path'
export const sportsCredentialGuides:Readonly<Record<string,{provider:string;url:string}>>={
  THE_ODDS_API_KEY:{provider:'The Odds API v4',url:'https://the-odds-api.com/'},
  THEODDSAPI_API_KEY:{provider:'TheOddsAPI',url:'https://theoddsapi.com/pricing'},
  THERUNDOWN_API_KEY:{provider:'TheRundown',url:'https://therundown.io/'},
  SPORTSGAMEODDS_API_KEY:{provider:'SportsGameOdds',url:'https://sportsgameodds.com/docs/basics/setup'},
  PHOENIX_API_FOOTBALL_KEY:{provider:'API-Football',url:'https://www.api-football.com/'},
  PHOENIX_API_HOCKEY_KEY:{provider:'API-Hockey',url:'https://www.api-hockey.com/'},
  PHOENIX_API_NFL_KEY:{provider:'API-NFL',url:'https://www.api-american-football.com/'},
  PHOENIX_BALLDONTLIE_API_KEY:{provider:'balldontlie',url:'https://www.balldontlie.io/'},
  PHOENIX_BIGBALLS_API_KEY:{provider:'Big Balls NHL',url:'https://www.bigdataball.com/'},
  PHOENIX_NFLMETA_KEY:{provider:'NFLMeta',url:'https://nflverse.nflverse.com/'},
  PHOENIX_SPORTMONKS_KEY:{provider:'Sportmonks',url:'https://www.sportmonks.com/'},
}
export type SportsKeyAskAction='status'|'request'|'mute'|'unmute'|'mute-all'|'unmute-all'
type Preferences={schema:1;never:boolean;muted:string[];asked:Record<string,string>}
const empty=():Preferences=>({schema:1,never:false,muted:[],asked:{}})
const statePath=(env:NodeJS.ProcessEnv)=>join(
  resolve(env.PHOENIX_SPORTS_SOURCE_HOME?.trim()||
    join(homedir(),'.phoenix','sports-sources')),'credential-ask-preferences.json')
async function readPrefs(path:string):Promise<Preferences>{
  try{
    const raw=JSON.parse(await readFile(path,'utf8')) as Partial<Preferences>
    if(raw.schema!==1)return empty()
    return{schema:1,never:raw.never===true,
      muted:Array.isArray(raw.muted)?raw.muted.filter(x=>
        typeof x==='string'&&Object.hasOwn(sportsCredentialGuides,x)):[],
      asked:raw.asked&&typeof raw.asked==='object'?raw.asked:{}}
  }catch{return empty()}
}
async function savePrefs(path:string,state:Preferences):Promise<void>{
  await mkdir(resolve(path,'..'),{recursive:true})
  const temp=path+'.'+process.pid+'.tmp'
  await writeFile(temp,JSON.stringify(state),{encoding:'utf8',mode:0o600})
  await rename(temp,path)
}
/** Returns a structured Ask proposal, or persisted "do not ask".
 * Host must present only the question; secret entry must occur in the vault
 * /secret command or a secure credential UI, never through chat/tool args.
 */
export async function sportsCredentialAsk(
  action:SportsKeyAskAction,ref:string|undefined,env:NodeJS.ProcessEnv=process.env,
  now=Date.now(),
){
  if(ref!==undefined&&!Object.hasOwn(sportsCredentialGuides,ref))
    throw Error('Referencia de credencial deportiva no admitida')
  if(['request','mute','unmute'].includes(action)&&!ref)
    throw Error('Se requiere referencia de proveedor')
  const path=statePath(env),prefs=await readPrefs(path)
  if(action==='mute-all')prefs.never=true
  if(action==='unmute-all')prefs.never=false
  if(action==='mute'&&ref&&!prefs.muted.includes(ref))prefs.muted.push(ref)
  if(action==='unmute'&&ref){
    prefs.muted=prefs.muted.filter(item=>item!==ref)
    delete prefs.asked[ref]
  }
  const denied=prefs.never||!!(ref&&prefs.muted.includes(ref))
  const seen=ref?Date.parse(prefs.asked[ref]??''):NaN
  const tooSoon=Number.isFinite(seen)&&now-seen>=0&&now-seen<30*86_400_000
  const offer=action==='request'&&!denied&&!tooSoon&&ref
  if(offer)prefs.asked[ref!]=new Date(now).toISOString()
  if(action!=='status'&&action!=='request'||offer)await savePrefs(path,prefs)
  const guide=ref?sportsCredentialGuides[ref]:null
  return{
    status:action==='request'?(denied?'suppressed':tooSoon?'already-asked':'ask'):'saved',
    ref:ref??null,provider:guide?.provider??null,guideUrl:guide?.url??null,
    neverAskAgain:prefs.never,mutedProviders:[...prefs.muted],
    question:offer?'¿Quieres conectar '+guide!.provider+
      ' con una API key opcional para ampliar las fuentes deportivas?':null,
    options:offer?['Configurar de forma segura','Ahora no','No volver a preguntar']:[],
    secureEntry:offer?'Conectores > APIs deportivas':null,
    secureConnectorTab:offer?'sports-api-keys':null,
    safety:'Nunca pegar la clave en una respuesta Ask ni en un mensaje de Kira. Tras el consentimiento abrir Conectores > APIs deportivas, pegarla en el formulario protegido del Host y guardar. Las fuentes públicas siguen funcionando.',
  }
}

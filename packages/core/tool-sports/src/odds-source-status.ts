/** Source discovery for Kira. Never equate configured, executable, or available with verified quotes. */
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {stat} from 'node:fs/promises'
import {isAbsolute,join} from 'node:path'
import {keylessEnabled,lastKeylessStatus} from './keyless-odds.ts'

const runFile=promisify(execFile)
export type OddsSourceHealth={name:string;kind:'current'|'historical';state:string;
  keyRequired:boolean;lastChecked?:string;quotesVerified?:number;detail:string}
const message=(e:unknown)=>e instanceof Error?e.message.slice(0,140):'Error desconocido'
/** Pure diagnostic summary; doesn't fetch bookmaker markets or install software. */
export async function describeOddsSources(
  sport='mlb',env:NodeJS.ProcessEnv=process.env,
  probe:(bin:string,args:string[])=>Promise<unknown>=async(bin,args)=>
    runFile(bin,args,{shell:false,windowsHide:true,timeout:3500,maxBuffer:10000}),
  fileExists:(path:string)=>Promise<boolean>=async path=>stat(path).then(s=>s.isFile()).catch(()=>false),
):Promise<{sources:OddsSourceHealth[];currentQuotesVerified:boolean;note:string}>{
  const sources:OddsSourceHealth[]=[]
  const observed=lastKeylessStatus()
  if(!keylessEnabled(env)){
    sources.push({name:'jordantete/OddsHarvester · OddsPortal',kind:'current',state:'disabled',
      keyRequired:false,detail:'Deshabilitado explícitamente por configuración. No se han consultado cuotas.'})
  }else{
    let runtime:'local'|'uvx'|'missing'='missing'
    let failure=''
    try{
      await probe(env.PHOENIX_SPORTS_ODDSHARVESTER_BIN||'oddsharvester',['--help'])
      runtime='local'
    }catch(e){
      failure=message(e)
      if(!env.PHOENIX_SPORTS_ODDSHARVESTER_BIN&&env.PHOENIX_SPORTS_ODDSHARVESTER_UVX_DISABLED!=='1'){
        try{await probe('uvx',['--version']);runtime='uvx'}catch(e2){failure=message(e2)}
      }
    }
    sources.push({name:'jordantete/OddsHarvester · OddsPortal',kind:'current',
      state:runtime==='missing'?'needs-setup':observed?.status==='unavailable'?'provider-error':
        observed?.status==='quotes'?'observed-quotes':'runtime-ready-unverified',
      keyRequired:false,
      ...(observed?{lastChecked:observed.checkedAt,quotesVerified:observed.count}:{}),
      detail:runtime==='local'?'CLI local detectada; Playwright, acceso al sitio y mercado se verifican al consultar.':
        runtime==='uvx'?'uvx disponible: ejecutará paquete fijado 0.13.0; navegador y acceso al sitio aún sin comprobar.':
          'Sin CLI/uvx utilizable: pnpm sports:odds:setup. '+failure,
    })
  }
  const commercial=[
    ['The Odds API v4','THE_ODDS_API_KEY'],
    ['TheOddsAPI','THEODDSAPI_API_KEY'],
  ] as const
  for(const [name,key] of commercial){
    const configured=Boolean(env[key]?.trim())
    sources.push({name,kind:'current',state:configured?'configured-unverified':'no-key',
      keyRequired:true,detail:configured?'Credencial presente, cotización y permisos no probados.':
        'Opcional; no es requisito para consultas públicas de OddsHarvester/ESPN.'})
  }
  sources.push({name:'ESPN Site/Core API',kind:'current',state:env.PHOENIX_SPORTS_ESPN_DISABLED==='1'?'disabled':'public-unverified',
    keyRequired:false,detail:'Marcadores públicos; solo ofrece cuotas si aparecen mercados verificables en el feed.'})
  const folder=env.PHOENIX_SPORTS_HISTORY_DIR
  const historical=[
    {name:'flancast90/sportsbookreview-scraper',file:'sportsbookreview-'+sport+'.json',supported:['nba','nfl','nhl','mlb'].includes(sport)},
    {name:'ArnavSaraogi/mlb-odds-scraper',file:'mlb-odds.json',supported:sport==='mlb'},
  ]
  for(const h of historical){
    const exists=h.supported&&Boolean(folder&&isAbsolute(folder))&&await fileExists(join(folder??'',h.file))
    sources.push({name:h.name,kind:'historical',state:!h.supported?'not-applicable':exists?'local-archive-present':'archive-not-installed',
      keyRequired:false,detail:exists?'Archivo presente; solo datos históricos, no cuotas actuales.':
        'Datos históricos de GitHub; instala archivos en PHOENIX_SPORTS_HISTORY_DIR para analizarlos. Nunca cotizar tickets con estos archivos.'})
  }
  return {sources,currentQuotesVerified:sources.some(x=>x.kind==='current'&&x.state==='observed-quotes'),
    note:'Estado de instalación ≠ prueba de cotizaciones vigentes. La fuente puede no cubrir una liga, un bookmaker o un país. Sin cuotas recientes, no se inventan precios.'}
}

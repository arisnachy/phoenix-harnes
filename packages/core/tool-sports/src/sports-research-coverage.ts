/** Sources mapped to each required sports dossier dimension.
 * 'planned' means documentation/catalog knowledge, NOT a live integration.
 * Provider responses are evidence only after each real fixture is reconciled.
 */
export type ResearchProvider={name:string;ref:string|null;
  state:'integrated'|'planned'|'official-followup';scope:string}
export type ResearchRequirement={sport:string;step:string;
  providers:ResearchProvider[];caveat:string}
const p=(name:string,ref:string|null,scope:string,
  state:ResearchProvider['state']='integrated'):ResearchProvider=>
    ({name,ref,state,scope})
const espn=p('ESPN Site/Core',null,'official-public')
const nhl=p('NHL Web API',null,'official-public')
const mlb=p('MLB StatsAPI',null,'official-public')
const db=p('TheSportsDB',null,'limited-public-v1')
const football=p('API-Football','PHOENIX_API_FOOTBALL_KEY','free-100-per-api')
const hockey=p('API-Hockey','PHOENIX_API_HOCKEY_KEY','free-100-per-api','planned')
const nfl=p('API-NFL','PHOENIX_API_NFL_KEY','free-100-per-api','planned')
const big=p('Big Balls NHL','PHOENIX_BIGBALLS_API_KEY','plan-dependent','planned')
const nfldata=p('nflverse',null,'public-archive')
const nflmeta=p('NFLMeta','PHOENIX_NFLMETA_KEY','licensed-and-tier-dependent','planned')
const sportmonks=p('Sportmonks','PHOENIX_SPORTMONKS_KEY',
  'free-Danish-Scottish-leagues-only','planned')
const openfootball=p('OpenFootball',null,'public-archives')
const official=p('Official league/team announcements',null,'human-follow-up','official-followup')
const quote=p('Live bookmaker quote connectors',null,'key-or-authorized-scraper')
export const researchCoverage:readonly ResearchRequirement[]=[
  {sport:'basketball',step:'form',providers:[espn,db],caveat:'Last games must precede kickoff'},
  {sport:'basketball',step:'efficiency',providers:[espn,db],
    caveat:'Pace/on-off not guaranteed by free endpoints'},
  {sport:'basketball',step:'injuries',providers:[espn,official],
    caveat:'NBA official report may be later than first prefetch'},
  {sport:'basketball',step:'starters',providers:[espn,official],
    caveat:'Roster is not confirmed five'},
  {sport:'basketball',step:'market',providers:[quote,espn],
    caveat:'Two-sided timestamped prices, one operator'},
  {sport:'hockey',step:'form',providers:[nhl,espn,db],
    caveat:'OT, shootout and last game distinguish'},
  {sport:'hockey',step:'goalies',providers:[nhl,espn,hockey,big,official],
    caveat:'Goalie position and projected starter are not confirmed starter'},
  {sport:'hockey',step:'xg',providers:[big,nhl,espn],
    caveat:'GSAx/5v5 xG may be paid or missing'},
  {sport:'hockey',step:'injuries',providers:[espn,big,official],
    caveat:'Current scratch and report timestamps necessary'},
  {sport:'hockey',step:'market',providers:[quote,espn,hockey],
    caveat:'Regulation vs OT/SO market identity required'},
  {sport:'baseball',step:'form',providers:[mlb,espn],
    caveat:'Completed innings and recent opponent matchups'},
  {sport:'baseball',step:'starters',providers:[mlb,espn,official],
    caveat:'Probable pitcher is not a confirmed active starter'},
  {sport:'baseball',step:'bullpen',providers:[mlb,espn],
    caveat:'Compute actual prior relief workload'},
  {sport:'baseball',step:'matchups',providers:[mlb,espn],
    caveat:'Batter-vs-pitcher small samples explicitly marked'},
  {sport:'baseball',step:'injuries',providers:[mlb,espn,official],
    caveat:'Lineups must be independently current'},
  {sport:'baseball',step:'market',providers:[quote,espn],
    caveat:'MLB moneyline includes full-game house settlement rules'},
  {sport:'football',step:'form',providers:[espn,nfldata,nfl],
    caveat:'QB/offense/defense must match real current roster'},
  {sport:'football',step:'qb',providers:[espn,nflmeta,nfl,official],
    caveat:'Depth chart does not confirm QB starter or inactives'},
  {sport:'football',step:'matchups',providers:[espn,nfldata,nflmeta],
    caveat:'EPA, OL/pass rush, snap counts require verified samples'},
  {sport:'football',step:'injuries',providers:[espn,nfldata,nflmeta,official],
    caveat:'Weekly injury report versus Sunday inactive list'},
  {sport:'football',step:'market',providers:[quote,espn],
    caveat:'Moneyline versus regulation or overtime rules'},
  {sport:'soccer',step:'form',providers:[espn,db,football,sportmonks,openfootball],
    caveat:'Home/away and opponent strength separately'},
  {sport:'soccer',step:'xg',providers:[espn,sportmonks],
    caveat:'Coverage by league/plan; never infer xG from scores'},
  {sport:'soccer',step:'lineups',providers:[espn,football,sportmonks,official],
    caveat:'Projected XI not a starting XI'},
  {sport:'soccer',step:'injuries',providers:[espn,football,sportmonks,official],
    caveat:'Team announcements and suspensions are needed'},
  {sport:'soccer',step:'draw',providers:[espn,football,quote],
    caveat:'90-minute 1X2 not a moneyline including extra time'},
  {sport:'tennis',step:'surface',providers:[espn,db],
    caveat:'ATP and WTA singles/doubles, surface exact'},
  {sport:'tennis',step:'serve',providers:[espn,db],
    caveat:'Serve/return split not guaranteed'},
  {sport:'tennis',step:'fatigue',providers:[espn,official],
    caveat:'Recent schedule, travel and match time'},
  {sport:'tennis',step:'injuries',providers:[espn,official],
    caveat:'No inferred medical status from a missing report'},
  {sport:'tennis',step:'market',providers:[quote,espn],
    caveat:'Walkover/retirement-specific settlement rules'},
]
export const researchCredentialRefs=[
  {ref:'PHOENIX_API_FOOTBALL_KEY',provider:'API-Football',use:'soccer fixtures and evidence'},
  {ref:'PHOENIX_API_HOCKEY_KEY',provider:'API-Hockey',use:'hockey supplement (planned specialist route)'},
  {ref:'PHOENIX_API_NFL_KEY',provider:'API-NFL',use:'football supplement (planned specialist route)'},
  {ref:'PHOENIX_BIGBALLS_API_KEY',provider:'Big Balls',use:'NHL supplemental xG, stats, injuries (plan-dependent)'},
  {ref:'PHOENIX_NFLMETA_KEY',provider:'NFLMeta',use:'NFL depth chart and roster (planned)'},
  {ref:'PHOENIX_SPORTMONKS_KEY',provider:'Sportmonks',use:'limited free soccer leagues (planned)'},
  {ref:'THE_ODDS_API_KEY',provider:'The Odds API v4',use:'bookmaker quotes'},
  {ref:'THEODDSAPI_API_KEY',provider:'TheOddsAPI',use:'bookmaker quotes'},
  {ref:'THERUNDOWN_API_KEY',provider:'TheRundown',use:'bookmaker quotes'},
  {ref:'SPORTSGAMEODDS_API_KEY',provider:'SportsGameOdds',use:'bookmaker quotes'},
] as const
export function coverageReport(configured:ReadonlySet<string>,sport?:string){
 const rows=researchCoverage.filter(x=>!sport||x.sport===sport)
 const missing=rows.flatMap(row=>row.providers.filter(p=>p.ref&&!configured.has(p.ref))
   .map(p=>({sport:row.sport,step:row.step,provider:p.name,ref:p.ref})))
 return{coverage:rows.map(row=>({
   sport:row.sport,step:row.step,caveat:row.caveat,
   providers:row.providers.map(provider=>({
     ...provider,configured:provider.ref===null||configured.has(provider.ref),
     usable:provider.state==='integrated'&&
       (provider.ref===null||configured.has(provider.ref)),
   })),
 })),missingOptionalCredentials:missing,authorizationNotice:
 'Una fuente de catálogo no equivale a datos observados. Configurar una clave es opcional; '+
 'seguir buscando en ESPN/NHL/MLB/otras fuentes autorizadas. '+
 'Nunca introducir secretos en argumentos de herramientas o mensajes para el modelo.'}
}

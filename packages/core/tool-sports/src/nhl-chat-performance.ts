/** Bounded, cancellable NHL chat work and compact model-facing evidence.
 * The full research object can contain thousands of historical player entries;
 * only the relevant summary and native visual card should enter Kira's context.
 */
import type {HockeyDossier,HockeyPlayer} from './nhl-evidence-research.ts'

export const NHL_CHAT_ODDS_BUDGET_MS=12_000
export const NHL_CHAT_RESEARCH_BUDGET_MS=48_000

/** Abort both the timeout race and the underlying HTTP requests. */
export async function withNhlDeadline<T>(
  work:(signal:AbortSignal)=>Promise<T>,limitMs:number,
):Promise<T>{
  const controller=new AbortController()
  let timer:ReturnType<typeof setTimeout>|undefined
  const timeout=new Promise<never>((_resolve,reject)=>{
    timer=setTimeout(()=>{
      // Reject first: abort listeners may resolve work synchronously.
      // A timed-out operation must NEVER win its own Promise.race.
      reject(Error('NHL_TIMEOUT: plazo de '+limitMs+' ms agotado'))
      controller.abort()
    },limitMs)
  })
  try{return await Promise.race([Promise.resolve().then(()=>work(controller.signal)),timeout])}
  finally{
    if(timer!==undefined)clearTimeout(timer)
    controller.abort()
  }
}

/** Preserve the per-provider 9s timeout while allowing a global deadline. */
export function nhlAbortableFetch(signal:AbortSignal):typeof fetch{
  return (input,init)=>fetch(input,{...init,
    signal:AbortSignal.any([signal,...(init?.signal?[init.signal]:[])])})
}

const compactPlayer=(p:HockeyPlayer)=>({
  name:p.name,team:p.team,role:p.role,
  starterConfirmed:p.starterConfirmed,idProvider:p.idProvider,
  stats:Object.fromEntries(Object.entries(p.stats).slice(0,10)),
  last5:p.last5.slice(0,3),
  ...(p.homeRoadSplits?{homeRoadSplits:p.homeRoadSplits}:{}),
})

/** Exact evidence remains in the original dossier for unit tests/internal use.
 * Avoid duplicating 20-game histories in players, goalieCandidates, UI and JSON.
 */
export function compactNhlChatDossier(d:HockeyDossier){
  const selected=(players:HockeyPlayer[])=>players
    .filter(p=>p.role==='goalie'||Object.keys(p.stats).length>0)
    .slice(0,12).map(compactPlayer)
  const form=(side:HockeyDossier['form']['home'])=>side?{
    games:side.games,wins:side.wins,losses:side.losses,
    homeGames:side.homeGames,awayGames:side.awayGames,
    restHours:side.restHours,last5:side.last10.slice(0,5),
  }:null
  const uiBlock={...d.uiBlock,props:{...d.uiBlock.props,
    sections:d.uiBlock.props.sections.slice(0,10).map(s=>({
      ...s,items:s.items.slice(0,/Skaters/iu.test(s.heading)?12:8),
    })),
  }}
  return{
    fixture:d.fixture,checkedAt:d.checkedAt,
    standings:d.standings,specialTeams:d.specialTeams,
    form:{home:form(d.form.home),away:form(d.form.away)},
    rosterCounts:{home:d.players.home.length,away:d.players.away.length},
    players:{home:selected(d.players.home),away:selected(d.players.away)},
    goalieCandidates:{
      home:d.goalieCandidates.home.slice(0,3).map(compactPlayer),
      away:d.goalieCandidates.away.slice(0,3).map(compactPlayer),
    },
    markets:d.markets.slice(0,12),possibleMatchups:d.possibleMatchups.slice(0,8),
    scenarios:d.scenarios,missingEvidence:d.missingEvidence.slice(0,12),
    opportunity:d.opportunity,uiBlock,
  }
}

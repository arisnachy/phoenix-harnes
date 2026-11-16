/** Official NHL 5v5 unblocked shot-attempt (Fenwick) evidence.
 * Goal/shot-on-goal/missed-shot ownership is the attacking team; blocked-shot
 * event ownership can be the DEFENDER and is intentionally excluded.
 * Five-on-five shot counts are NOT xG, danger-weighted attempts or GSAx.
 */
export type Nhl5v5Game={
  gameId:string;date:string;homeTeamId:string;awayTeamId:string;
  home:{fenwick:number;shots:number;goals:number};
  away:{fenwick:number;shots:number;goals:number};
  usable:boolean;reason:string|null
}
export type Nhl5v5Side={
  teamId:string;games:number;fenwickFor:number;fenwickAgainst:number;
  fenwickPct:number|null;shotsFor:number;shotsAgainst:number;
  goalsFor:number;goalsAgainst:number;
}
export type Nhl5v5Audit={
  home:Nhl5v5Side;away:Nhl5v5Side;requested:number;verified:number;
  missingGameIds:string[];source:'NHL gamecenter play-by-play';
  label:'5v5 Fenwick (unblocked attempts), NOT expected goals';
}
const obj=(x:unknown):Record<string,unknown>=>x&&typeof x==='object'&&!Array.isArray(x)?
  x as Record<string,unknown>:{}
const arr=(x:unknown):unknown[]=>Array.isArray(x)?x:[]
const id=(x:unknown)=>/^[0-9]{1,18}$/u.test(String(x??''))?String(x):''
const zero=()=>({fenwick:0,shots:0,goals:0})
/** An official completed game from before the requested prediction cutoff. */
export function parseNhl5v5Game(payload:unknown,
  expectedId:string,pregameCutoff:string):Nhl5v5Game{
  const root=obj(payload),homeId=id(obj(root.homeTeam).id),
    awayId=id(obj(root.awayTeam).id)
  const gameId=id(root.id)
  const date=String(root.startTimeUTC??root.gameDate??'')
  const time=Date.parse(date.length===10?date+'T12:00:00Z':date)
  const cutoff=Date.parse(pregameCutoff)
  const home=zero(),away=zero()
  const invalid=(reason:string):Nhl5v5Game=>({
    gameId,date,homeTeamId:homeId,awayTeamId:awayId,
    home,away,usable:false,reason,
  })
  if(!gameId||gameId!==expectedId||!homeId||!awayId||homeId===awayId)
    return invalid('Identidad de juego o equipos no coincide')
  if(!Number.isFinite(cutoff)||!Number.isFinite(time)||time>=cutoff)
    return invalid('Fecha posterior al corte pregame o ausente')
  if(!['OFF','FINAL'].includes(String(root.gameState??'')))
    return invalid('Partido no finalizado; excluir snapshots en directo')
  const plays=arr(root.plays)
  if(plays.length<100)return invalid('Play-by-play insuficiente')
  for(const raw of plays){
    const p=obj(raw),period=obj(p.periodDescriptor)
    if(p.situationCode!=='1551'||period.periodType!=='REG')continue
    const type=String(p.typeDescKey??'')
    if(!['goal','shot-on-goal','missed-shot'].includes(type))continue
    const owner=id(obj(p.details).eventOwnerTeamId)
    const target=owner===homeId?home:owner===awayId?away:null
    if(!target)continue
    target.fenwick++
    if(type==='goal'||type==='shot-on-goal')target.shots++
    if(type==='goal')target.goals++
  }
  if(home.fenwick+away.fenwick<8)return invalid('Pocos tiros 5v5 verificables')
  return{gameId,date,homeTeamId:homeId,awayTeamId:awayId,
    home,away,usable:true,reason:null}
}
function side(teamId:string,ids:readonly string[],
  games:ReadonlyMap<string,Nhl5v5Game>):Nhl5v5Side{
  const output:Nhl5v5Side={teamId,games:0,fenwickFor:0,
    fenwickAgainst:0,fenwickPct:null,shotsFor:0,shotsAgainst:0,
    goalsFor:0,goalsAgainst:0}
  for(const id of [...new Set(ids)]){
    const g=games.get(id)
    if(!g?.usable)continue
    const forSide=g.homeTeamId===teamId?g.home:
      g.awayTeamId===teamId?g.away:null
    const against=g.homeTeamId===teamId?g.away:
      g.awayTeamId===teamId?g.home:null
    if(!forSide||!against)continue
    output.games++
    output.fenwickFor+=forSide.fenwick
    output.fenwickAgainst+=against.fenwick
    output.shotsFor+=forSide.shots
    output.shotsAgainst+=against.shots
    output.goalsFor+=forSide.goals
    output.goalsAgainst+=against.goals
  }
  const attempts=output.fenwickFor+output.fenwickAgainst
  output.fenwickPct=attempts?
    Number((output.fenwickFor/attempts*100).toFixed(2)):null
  return output
}
export function aggregateNhl5v5(input:{
  home:{teamId:string;gameIds:string[]};away:{teamId:string;gameIds:string[]};
  games:Nhl5v5Game[];
}):Nhl5v5Audit{
  const requestedIds=[...new Set([...input.home.gameIds,...input.away.gameIds])]
  const found=new Map(input.games.map(g=>[g.gameId,g]))
  const missingGameIds=requestedIds.filter(id=>!found.get(id)?.usable)
  return{home:side(input.home.teamId,input.home.gameIds,found),
    away:side(input.away.teamId,input.away.gameIds,found),
    requested:requestedIds.length,verified:requestedIds.length-missingGameIds.length,
    missingGameIds,source:'NHL gamecenter play-by-play',
    label:'5v5 Fenwick (unblocked attempts), NOT expected goals'}
}

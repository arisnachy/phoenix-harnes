/** A full daily research BOARD even when five priced wagers are not possible.
 * The board is not an instruction to wager. An unresearched fixture has NO pick.
 */
export type DailyTicketFixture={
  sport:string;league:string;eventId:string;kickoff:string;
  home:{name:string};away:{name:string}
}
export type DailyTicketChoice={sport:string;league:string;eventId:string;pick:'home'|'away'}
export type DailyResearchSlot={
  eventId:string;sport:string;league:string;home:string;away:string;kickoff:string;
  state:'candidate'|'investigate';
  choice:'home'|'away'|null;
  /** A selection is NEVER inferred from game existence. */
  selection:string|null;
  verifiedFixture:true;quoted:false;approvedForBetting:false;
  explanation:string
}
export type DailyCoverageBoard={
  requestedLegs:number;
  slots:DailyResearchSlot[];
  selectedCandidates:number;
  researchOnly:number;
  missingFixtures:number;
  coverageComplete:boolean;
  status:'research-board-full'|'insufficient-fixtures';
  note:string
}
const identity=(v:Pick<DailyTicketFixture,'sport'|'league'|'eventId'>)=>
  v.sport+'|'+v.league+'|'+v.eventId
const valid=(e:DailyTicketFixture,now:number):boolean=>
  /^\d{1,20}$/u.test(e.eventId)&&
  /^\S{2,80}$/u.test(e.sport)&&/^\S{2,100}$/u.test(e.league)&&
  !!e.home.name.trim()&&!!e.away.name.trim()&&
  e.home.name!==e.away.name&&Number.isFinite(Date.parse(e.kickoff))&&
  Date.parse(e.kickoff)>now
/** Fill missing research positions with REAL future fixtures from the scout.
 * These are visible research cases, not picks, not prices and not "approved".
 * The planner never changes the list of actual ranked selections.
 */
export function buildDailyResearchBoard(
  discovered:readonly DailyTicketFixture[],choices:readonly DailyTicketChoice[],
  requestedLegs:number,now=Date.now(),
):DailyCoverageBoard{
  // The reusable ticket tool also supports one-off 1–4-game research.
  // Its DAILY invocation still requests five or six by default.
  if(!Number.isInteger(requestedLegs)||requestedLegs<1||requestedLegs>6)
    throw Error('Tablero de investigación requiere entre 1 y 6 posiciones')
  const fixtures=new Map<string,DailyTicketFixture>()
  for(const f of discovered)if(valid(f,now)&&!fixtures.has(identity(f)))
    fixtures.set(identity(f),f)
  const slots:DailyResearchSlot[]=[],selected=new Set<string>()
  const add=(fixture:DailyTicketFixture,choice:DailyTicketChoice|null)=>{
    const key=identity(fixture)
    if(selected.has(key)||slots.length>=requestedLegs)return
    selected.add(key)
    const selection=choice?choice.pick==='home'?fixture.home.name:fixture.away.name:null
    slots.push({eventId:fixture.eventId,sport:fixture.sport,league:fixture.league,
      home:fixture.home.name,away:fixture.away.name,kickoff:fixture.kickoff,
      state:choice?'candidate':'investigate',choice:choice?.pick??null,selection,
      verifiedFixture:true,quoted:false,approvedForBetting:false,
      explanation:choice?
        'Elección de investigación según ranking; faltan cotejos finales y cuota.':
        'Partido real verificado, sin selección fundamentada todavía; investigar antes de elegir.'})
  }
  for(const c of choices){
    const fixture=fixtures.get(identity(c))
    if(fixture)add(fixture,c)
  }
  // Recovery prioritizes a different sport when otherwise similarly covered.
  // Do not mint a winner just to satisfy a numeric target.
  const remaining=[...fixtures.values()].filter(f=>!selected.has(identity(f)))
    .sort((a,b)=>Date.parse(a.kickoff)-Date.parse(b.kickoff)||
      identity(a).localeCompare(identity(b)))
  while(slots.length<requestedLegs&&remaining.length){
    const present=new Set(slots.map(s=>s.sport))
    const idx=remaining.findIndex(f=>!present.has(f.sport))
    const f=remaining.splice(idx<0?0:idx,1)[0]!
    add(f,null)
  }
  const selectedCandidates=slots.filter(s=>s.state==='candidate').length
  const researchOnly=slots.length-selectedCandidates
  const missingFixtures=requestedLegs-slots.length
  const coverageComplete=missingFixtures===0
  const visible=slots.map(x=>x.home+' vs '+x.away+' ['+
    (x.selection??'SIN PICK')+']').join('; ').slice(0,550)
  return{requestedLegs,slots,selectedCandidates,researchOnly,missingFixtures,
    coverageComplete,status:coverageComplete?'research-board-full':'insufficient-fixtures',
    note:coverageComplete?
      'Se muestran '+slots.length+' partidos reales; '+selectedCandidates+
      ' selecciones de investigación y '+researchOnly+
      ' encuentros aún sin selección. NO es un boleto de '+requestedLegs+
      ' cuotas ni garantiza '+requestedLegs+' apuestas sustentadas. '+visible:
      'Solo '+slots.length+' partidos futuros verificables para '+requestedLegs+
      ' posiciones: faltan '+missingFixtures+
      '. No inventar eventos, favoritos, cuotas o disponibilidad. '+visible}
}

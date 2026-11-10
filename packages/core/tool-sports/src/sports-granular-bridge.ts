/** Domain-specific bridges from observed dossiers to original granular steps.
 * These functions preserve missing/partial states; they never infer that an
 * odds snapshot, roster or simple matchup is a complete betting forecast.
 */
import type {StepObservation} from './daily-specialist-checklist.ts'
import type {NflDossier} from './nfl-evidence-research.ts'
import type {HockeyDossier} from './nhl-evidence-research.ts'
import type {MlbCase} from './mlb-evidence-research.ts'
import type {SoccerDossier} from './soccer-worldwide-dossier.ts'
import type {TennisDossier} from './tennis-evidence-research.ts'

type Audit=Record<string,StepObservation>
const put=(r:Audit,key:string,ok:boolean,detail:string)=>{
  r[key]={state:ok?'partial':'missing',detail:detail.slice(0,500)}
}
const isVenue=(text:string)=>Boolean(text&&
  !/^(?:unknown|no verificado|sede no confirmada|estadio no verificado|
    sin verificar|sin sede)$/iu.test(text.trim()))
const identity=(r:Audit,key:string,id:unknown,time:string,venue:string,detail:string)=>{
  const complete=Boolean(id&&Number.isFinite(Date.parse(time))&&isVenue(venue))
  r[key]={state:complete?'verified':'partial',detail:detail.slice(0,500)}
}
export function nflDeepSignals(d:NflDossier):Audit{
 const r:Audit={},h=d.teams.home,a=d.teams.away,e=d.event
 identity(r,'N01',e.eventId,e.scheduledAt,e.venue,
   e.away.name+' vs '+e.home.name+' '+e.scheduledAt+' · '+e.venue)
 r.U01=r.N01
 put(r,'N02',h.recent.length>=3&&a.recent.length>=3,
   h.name+' '+h.recent.length+' juegos, '+a.name+' '+a.recent.length+
   '; faltan ventana 10 y calidad de rivales')
 r.U02=r.N02
 const stats=[...h.teamStats,...a.teamStats]
 put(r,'N03',stats.some(x=>/epa|success|drive|defense|offense/i.test(x.name)),
   stats.filter(x=>/epa|success|drive|defense|offense/i.test(x.name))
    .slice(0,9).map(x=>x.name+': '+x.value).join('; ')+
    '; EPA/play y métricas ajustadas deben aparecer para ambos equipos')
 r.U03=r.N03
 const qb=[h,a].map(t=>t.roster.filter(p=>p.role==='quarterback')
   .map(p=>p.name+(p.confirmedOffense?' confirmado':' sin titularidad')+
     ' ('+p.statistics.length+' métricas)'))
 put(r,'N04',qb.every(x=>x.length>0),qb.map(x=>x.join(', ')).join(' | ')+
   '; faltan CPOE, presión e inactivos contrastados')
 const starters=[h,a].map(t=>t.offenseConfirmed+t.defenseConfirmed)
 put(r,'N05',starters.some(Boolean),'Titulares observados '+starters[0]+
   '/22 local, '+starters[1]+'/22 visitante; snaps y 44 jugadores por cotejar')
 put(r,'N06',d.matchups.length>0,d.matchups.length+
   ' emparejamientos candidatos; presión OL vs DL no cuantificada')
 put(r,'N07',d.matchups.length>0,d.matchups.length+
   ' emparejamientos sin cobertura/recepciones individuales verificadas')
 put(r,'N08',stats.length>0,'Rendimiento terrestre frente defensa: '+stats.length+
   ' métricas de equipo (no validan por sí mismas boxes/rush EPA)')
 put(r,'N09',stats.length>0,'Equipos especiales, red zone y turnovers: '+
   stats.length+' estadísticas encontradas, conjunto incompleto')
 put(r,'N10',d.injuries.length>0,d.injuries.length+
   ' bajas registradas; lista final de inactivos pendiente')
 put(r,'N11',!!d.weather?.timestamp,d.weather?
   'Viento '+(d.weather.windKmh??'?')+' km/h, temperatura '+
   (d.weather.temperatureC??'?')+' C; campo/techo por cotejar':
   'Sin meteorología horario-estadio validada')
 r.U06=r.N11
 put(r,'N12',d.markets.length>0,d.markets.length+
   ' mercados observados; sin probabilidades calibradas ni spread/total independientes')
 r.U04=r.N07
 r.U08={state:'missing',detail:'Sin modelo ML/spread/total calibrado y auditado'}
 r.U09=r.N12
 put(r,'U10',d.news.length+d.editorial.length>0,
   d.news.length+' noticias y '+d.editorial.length+' opiniones; auditoría adversarial pendiente')
 return r
}
export function nhlDeepSignals(d:HockeyDossier):Audit{
 const r:Audit={},f=d.fixture,h=d.form.home,a=d.form.away
 identity(r,'H01',f.id,f.date,f.venue,
   f.away.name+' vs '+f.home.name+' · '+f.venue+' · '+f.date)
 r.U01=r.H01
 put(r,'H02',(h?.games??0)>=5&&(a?.games??0)>=5,
   'Últimos '+(h?.games??0)+' local y '+(a?.games??0)+
   ' visitante; fuerza de calendario y ventana 20 pendientes')
 r.U02=r.H02
 put(r,'H03',(h?.games??0)>0&&(a?.games??0)>0,
   'Marcadores existentes; falta distinguir regulación 60min vs OT/SO')
 put(r,'H04',(h?.games??0)>0&&(a?.games??0)>0,
   'Local: '+(h?.wins??0)+'V/'+(h?.losses??0)+'D, '+
   (h?.homeGames??0)+' casa; visita: '+(a?.wins??0)+'V/'+(a?.losses??0)+
   'D, '+(a?.awayGames??0)+' fuera; tiros/goal diff por verificar')
 const goalie=[d.goalieCandidates.home,d.goalieCandidates.away]
 put(r,'H06',goalie.every(x=>x.length>0),
   'Candidatos '+goalie[0]!.map(x=>x.name).join(', ')+' / '+
   goalie[1]!.map(x=>x.name).join(', ')+
   '; SV%, GSAx, últimas salidas y rival no completos')
 put(r,'H07',goalie.every(x=>x.length>0),
   'Porteros observados, NINGUNO confirmado titular por esta fuente')
 put(r,'H09',d.players.home.length>0&&d.players.away.length>0,
   d.players.home.length+' jugadores locales, '+d.players.away.length+
   ' visitantes; líneas, scratches y bajas por cotejar')
 put(r,'H10',h?.restHours!==null&&h?.restHours!==undefined&&
   a?.restHours!==null&&a?.restHours!==undefined,
   'Descanso local '+(h?.restHours??'?')+
   ' h / visitante '+(a?.restHours??'?')+' h; viajes por confirmar')
 put(r,'H12',d.markets.length>0,d.markets.length+
   ' líneas observadas; verificar si ML incluye OT/SO y vigencia del proveedor')
 r.U04=r.H09;r.U06=r.H10
 r.U08={state:'missing',detail:'Sin modelo NHL ML/puck line/total calibrado'}
 r.U09=r.H12
 return r
}
export function mlbDeepSignals(d:MlbCase):Audit{
 const r:Audit={},f=d.fixture,h=d.teamForm.home,a=d.teamForm.away
 identity(r,'M01',f.gamePk,f.date,f.venue.name,
   'gamePk '+f.gamePk+' · '+f.away.name+' vs '+f.home.name+
   ' · '+f.venue.name+' · '+f.date+'; dobles carteleras cotejar')
 r.U01=r.M01
 put(r,'M02',(h?.games??0)>=5&&(a?.games??0)>=5,
   (h?.games??0)+' juegos locales; '+(a?.games??0)+
   ' visitantes; resultado 5/10/20 y calidad de rivales pendientes')
 r.U02=r.M02
 put(r,'M03',!!h&&!!a,
   'Splits casa '+(h?.home.wins??0)+'V, '+(a?.away.wins??0)+
   'V visitante; vs zurdo/derecho no contrastado')
 const starters=[d.starters.home,d.starters.away]
 put(r,'M04',starters.every(Boolean),starters.map(x=>x?
   x.name+' ERA '+(x.season.era??'?')+' WHIP '+(x.season.whip??'?'):
   'abridor sin verificar').join(' | ')+
   '; falta FIP/xFIP, repertorio y últimas salidas')
 put(r,'M05',d.matchups.length>0,d.matchups.length+
   ' enfrentamientos abridor-bateador candidatos, muestras por validar')
 put(r,'M06',d.rosters.home.length>0&&d.rosters.away.length>0,
   'Rosters '+d.rosters.home.length+'/'+d.rosters.away.length+
   ', splits wOBA/xwOBA/hard-hit no completos')
 const bvp=d.matchups.filter(x=>x.bvp!==null).length
 put(r,'M07',bvp>0,bvp+' cruces con registro BvP de '+
   d.matchups.length+'; tamaño de muestra y arsenal pendientes')
 const rel=[d.bullpen.home,d.bullpen.away].map(a=>
   a.filter(x=>x.reliefUsage72h.length>0).length)
 put(r,'M08',rel.every(n=>n>0),'Relevistas con 72h de uso: local '+
   rel[0]+', visitante '+rel[1]+'; confirmar carga 24/48h')
 put(r,'M09',d.lineupStatus.home==='confirmed'&&
   d.lineupStatus.away==='confirmed','Lineups '+
   d.lineupStatus.home+'/'+d.lineupStatus.away+
   ', '+d.injuries.length+' bajas de roster; estado final por cotejar')
 put(r,'M10',d.weather?.time!==undefined,
   'Parque '+d.venue.name+', techo '+d.venue.roofType+
   ', viento '+(d.weather?.windSpeedKmh??'?')+' km/h, '+
   'dirección '+(d.weather?.windDirectionDegrees??'?')+
   '; efecto relativo al campo no confirmado')
 put(r,'M13',d.odds.length>0,d.odds.length+
   ' mercados; confirmación de abridores y liquidación pendiente')
 r.U03=r.M04;r.U04=r.M07;r.U06=r.M10
 r.U08={state:'missing',detail:'Faltan modelos F5/ML/run line/totales calibrados'}
 r.U09=r.M13
 return r
}
export function soccerDeepSignals(d:SoccerDossier):Audit{
 const r:Audit={},f=d.fixture,h=d.teams.home,a=d.teams.away
 identity(r,'S01',f.eventId,d.opportunity.scheduledAt,d.stadium,
   f.away.name+' vs '+f.home.name+' · '+d.stadium+
   ' · '+d.opportunity.scheduledAt)
 r.U01=r.S01
 put(r,'S02',h.recent.length>=5&&a.recent.length>=5,
   h.recent.length+'/'+a.recent.length+' juegos; últimos 20 y fuerza de rival pendientes')
 r.U02=r.S02
 put(r,'S03',!!h.form&&!!a.form,
   'Casa '+(h.form?.homeWdl??'?')+' / visita '+
   (a.form?.awayWdl??'?')+'; xG ajustado no comprobado')
 const xg=d.teamStatistics.filter(x=>/xg|expected.*goals/iu.test(x.label))
 put(r,'S04',xg.length>0,xg.slice(0,9).map(x=>x.label+' '+x.value).join('; ')+
   '; xG y xGA de ambos equipos por cotejar')
 const shots=d.teamStatistics.filter(x=>/possession|shot|tiros|posesion/iu.test(x.label))
 put(r,'S05',shots.length>0,shots.slice(0,9).map(x=>x.label+' '+x.value).join('; ')+
   '; calidad de ocasiones pendiente')
 put(r,'S06',h.roster.length>0&&a.roster.length>0,
   h.roster.length+' jugadores locales, '+a.roster.length+
   ' visitantes; producción individual sin confirmar')
 put(r,'S07',d.duels.length>0,d.duels.length+
   ' cruces potenciales; tácticas y pressing no demostrados')
 put(r,'S09',d.lineupConfirmed.home&&d.lineupConfirmed.away,
   'Onces '+d.lineupConfirmed.home+'/'+d.lineupConfirmed.away+
   ', '+d.injuries.length+' bajas; sanciones a cotejar')
 put(r,'S10',h.recent.length>0&&a.recent.length>0,
   'Calendarios observados; congestión/viaje internacional por verificar')
 put(r,'S11',!!d.referee||!!d.weather,
   'Árbitro '+(d.referee??'no asignado')+', clima '+
   (d.weather?.temperatureC??'?')+' C; motivación/tabla por contrastar')
 put(r,'S13',d.markets.length>0,d.markets.length+
   ' mercados observados; reglamento 90 min y movimientos sin cotejo')
 r.U04=r.S07;r.U06=r.S11
 r.U08={state:'missing',detail:'Sin modelo 1X2/empate/BTTS calibrado por liga'}
 r.U09=r.S13
 put(r,'U10',d.headlines.length+d.editorial.length>0,
   d.headlines.length+' noticias; '+d.editorial.length+
   ' editoriales; auditoría adversarial pendiente')
 return r
}
export function tennisDeepSignals(d:TennisDossier):Audit{
 const r:Audit={},m=d.match
 identity(r,'T01',m.matchId,m.start,m.tournament,
   m.players.map(x=>x.name).join(' vs ')+' · '+m.tournament+
   ', ronda '+m.round+', superficie '+(m.surface??'?')+', '+m.start)
 r.U01=r.T01
 put(r,'T02',d.coverage.rankCount===2&&d.players.every(x=>x.lastMatches.length>=5),
   'Rankings '+d.coverage.rankCount+'/2; últimos partidos '+
   d.players.map(x=>x.lastMatches.length).join('/')+
   '; Elo y dificultad de rivales sin cotejo')
 r.U02=r.T02
 put(r,'T03',!!m.surface,'Superficie '+(m.surface??'desconocida')+
   '; forma por superficie e indoor/outdoor pendiente')
 const stats=d.players.map(x=>x.statistics)
 const seen=(pattern:RegExp)=>stats.every(a=>a.some(x=>pattern.test(x.name)))
 put(r,'T04',seen(/first.?serve|ace|double.?fault/iu),
   'Servicio observado de ambos: '+stats.map(x=>x.length).join('/')+
   ' métricas, falta desglosar 1º/2º, aces y dobles')
 put(r,'T05',seen(/break|return|resto/iu),
   'Devolución de ambos: '+stats.map(x=>x.length).join('/')+
   ' métricas; break points/return points por cotejar')
 put(r,'T06',seen(/hold|break|tie.?break/iu),
   'Hold, break y tie-breaks requieren series y muestra por superficie')
 put(r,'T10',d.players.some(x=>x.lastMatches.length>0),
   d.players.map(x=>x.lastMatches.length).join('/')+
   ' partidos históricos; duración, viajes y fatiga pendientes')
 put(r,'T12',d.markets.length>0,d.markets.length+
   ' precios observados; retiradas y super-tiebreak bajo reglas del operador')
 r.U03=r.T04;r.U04=r.T05;r.U06=r.T10
 r.U08={state:'missing',detail:'Falta modelo de servicio/retorno ML-sets-juegos calibrado'}
 r.U09=r.T12
 return r
}

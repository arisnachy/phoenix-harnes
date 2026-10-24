/* Phoenix Sports Studio UI. All provider text uses textContent, never HTML injection. */
const $=id=>document.getElementById(id)
const NAMES={soccer:'⚽ Fútbol',basketball:'🏀 Baloncesto',baseball:'⚾ Béisbol',football:'🏈 Fútbol americano',hockey:'🏒 Hockey',tennis:'🎾 Tenis',mma:'🥊 MMA',racing:'🏎️ Automovilismo',golf:'⛳ Golf',rugby:'🏉 Rugby','rugby-league':'🏉 Rugby League',cricket:'🏏 Críquet',lacrosse:'🥍 Lacrosse',volleyball:'🏐 Voleibol','water-polo':'🤽 Waterpolo','field-hockey':'🏑 Hockey césped','australian-football':'🏉 Fútbol australiano'}
const ODDS_KEYS={baseball:'baseball_mlb',soccer:'soccer_epl',basketball:'basketball_nba',football:'americanfootball_nfl',hockey:'icehockey_nhl',tennis:'tennis_atp_french_open',mma:'mma_mixed_martial_arts',racing:'',golf:'golf_pga_championship',rugby:'rugbyunion_six_nations',cricket:'cricket_ipl'}
let catalog={},sport='baseball',legs=[],oddsRows=[]
const make=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=String(text);if(cls)e.className=cls;return e}
const empty=(el,msg)=>el.replaceChildren(make('div',msg,'empty'))
const txt=(id,text)=>$(id).textContent=text
const dateTime=(date)=>{if(!date)return 'Fecha sin confirmar';try{return new Intl.DateTimeFormat('es-DO',{timeZone:'America/Santo_Domingo',dateStyle:'medium',timeStyle:'short'}).format(new Date(date))}catch{return date}}
async function api(url,options){
  const response=await fetch(url,options)
  const data=await response.json()
  if(!response.ok||!data.ok)throw new Error(data.error||'Proveedor no disponible')
  return data
}
const post=(path,obj)=>api(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(obj)})
function option(value,label){const e=make('option',label);e.value=value;return e}
function updateLeagues(){
  const approved=(catalog.candidates||[]).filter(c=>c.source==='espn'&&c.state==='approved'&&c.sport===sport).map(c=>c.league)
  const leagues=[...new Set([...(catalog.sports[sport]||[]),...approved])]
  $('league').replaceChildren(...(leagues.length?leagues.map(x=>option(x,x)): [option('','Descubrir ligas')]))
  const preferred=ODDS_KEYS[sport]
  if(preferred&&[...$('oddsSport').options].some(o=>o.value===preferred))$('oddsSport').value=preferred
  for(const b of document.querySelectorAll('.sport'))b.setAttribute('aria-current',String(b.dataset.sport===sport))
}
function renderSports(){
  $('sports').replaceChildren(...Object.keys(catalog.sports).map(key=>{
    const b=make('button',NAMES[key]||key,'sport');b.type='button';b.dataset.sport=key
    b.onclick=()=>{sport=key;updateLeagues();txt('status','Selecciona la liga para consultar resultados actuales.')}
    return b
  }))
  updateLeagues()
}
function renderSources(){
  const el=$('sources');el.replaceChildren()
  for(const s of catalog.sources){
    const row=make('div',undefined,'source-item')
    const name=make('div')
    name.append(make('strong',s.title),make('div',s.authorized?s.health.status:'Sin acceso configurado','muted'))
    const right=make('div',s.authorized?s.health.score+'/100':'—')
    row.append(name,right)
    if(s.observations?.quarantined){
      const button=make('button','Revisar','secondary')
      button.onclick=async()=>{try{await post('/api/review-source',{id:s.id,action:'restore'});await reload()}catch(e){txt('status',e.message)}}
      row.append(button)
    }
    el.append(row)
  }
}
function renderCandidates(){
  const rows=(catalog.candidates||[]).filter(c=>c.source==='espn'&&c.sport===sport).slice(-35)
  const panel=$('candidates');panel.replaceChildren()
  if(!rows.length){empty(panel,'Sin nuevas competiciones verificadas para este deporte.');return}
  for(const c of rows){
    const el=make('div',undefined,'source-item')
    el.append(make('span',c.league+' · '+c.state))
    if(c.state==='candidate'){
      const b=make('button','Aprobar','secondary')
      b.onclick=async()=>{try{await post('/api/approve-league',{sport:c.sport,league:c.league});await reload()}catch(e){txt('status',e.message)}}
      el.append(b)
    }
    panel.append(el)
  }
}
function renderOddsSports(){
  const discovered=(catalog.candidates||[]).filter(c=>c.source==='the-odds-api')
  const known=Object.values(ODDS_KEYS).filter(Boolean)
  const entries=new Map()
  for(const k of known)entries.set(k,k)
  for(const c of discovered)entries.set(c.key,c.title+' · '+c.group)
  $('oddsSport').replaceChildren(...[...entries].map(([key,name])=>option(key,name)))
}
function avatar(name,url){
  const badge=make('div',undefined,'badge-logo')
  let safe=false
  try{const u=new URL(url);safe=u.protocol==='https:'&&['a.espncdn.com','img.mlbstatic.com'].includes(u.hostname)}catch{}
  if(safe){const img=make('img');img.src=url;img.alt=name;img.loading='lazy';img.onerror=()=>badge.replaceChildren(make('span',(name||'?').slice(0,2).toUpperCase()));badge.append(img)}
  else badge.append(make('span',(name||'?').slice(0,2).toUpperCase()))
  return badge
}
function teamView(team){
  const col=make('div',undefined,'team')
  col.append(avatar(team.name,team.logo),make('div',team.name||'Por confirmar'))
  if(team.score!==null&&team.score!==undefined)col.append(make('div',team.score,'score'))
  return col
}
function detailButton(label,callback){
  const b=make('button',label,'secondary');b.type='button';b.onclick=callback;return b
}
function statsDetails(parent,data,title){
  const view=make('div',undefined,'notice')
  view.append(make('strong',title))
  const pre=make('pre',JSON.stringify(data,null,2).slice(0,10000))
  view.append(pre)
  parent.append(view)
}
async function playerStatistics(parent,id,name){
  try{const d=await api('/api/mlb/pitcher?id='+encodeURIComponent(id));statsDetails(parent,d.statistics,name+' · '+d.season)}
  catch(e){statsDetails(parent,{error:e.message},name)}
}
async function bullpen(parent,team){
  try{
    const data=await api('/api/mlb/roster?team='+encodeURIComponent(team.id))
    const box=make('div',undefined,'notice')
    box.append(make('h3','Cuerpo de lanzadores · '+team.name))
    for(const p of data.pitchers){
      const line=make('div',p.name+' · '+(p.position||'P'),'source-item')
      if(p.headshot)line.prepend(avatar(p.name,p.headshot))
      line.append(detailButton('Estadísticas',()=>playerStatistics(box,p.id,p.name)))
      box.append(line)
    }
    parent.append(box)
  }catch(e){statsDetails(parent,{error:e.message},'Bullpen')}
}
function gameCard(g){
  const card=make('article',undefined,'game')
  const top=make('div',undefined,'game-top')
  top.append(make('span',dateTime(g.date)),make('span',g.status||'Pendiente'))
  const teams=make('div',undefined,'teams')
  teams.append(teamView(g.away),make('div','VS','vs'),teamView(g.home))
  const venue=make('div','⌖ '+(g.venue||'Estadio pendiente de confirmar')+(g.city?' · '+g.city:''),'meta')
  const source=make('div','Fuente: '+g.source+' · verificado '+dateTime(g.lastVerifiedAt),'small')
  const buttons=make('div',undefined,'details')
  if(g.pitchers?.length){
    card.append(top,teams,venue,make('div','Lanzadores probables: '+g.pitchers.map(p=>p.name).join(' / '),'meta'))
    for(const p of g.pitchers)if(p.id){
      const portrait=make('span')
      if(p.headshot)portrait.append(avatar(p.name,p.headshot))
      portrait.append(detailButton('⚾ '+p.name,()=>playerStatistics(card,p.id,p.name)))
      buttons.append(portrait)
    }
  } else card.append(top,teams,venue)
  if(g.sport==='baseball'&&g.league==='mlb'){
    if(g.home.id)buttons.append(detailButton('Bullpen local',()=>bullpen(card,g.home)))
    if(g.away.id)buttons.append(detailButton('Bullpen visitante',()=>bullpen(card,g.away)))
  }
  card.append(source,buttons)
  return card
}
async function loadGames(){
  if(!$('league').value){txt('status','Esta disciplina requiere descubrir y aprobar una competición.');return}
  txt('status','Consultando datos reales...')
  try{
    const q=new URLSearchParams({sport,league:$('league').value,date:$('date').value})
    const result=await api('/api/board?'+q)
    txt('count',result.games.length+' eventos')
    if(result.games.length)$('games').replaceChildren(...result.games.slice(0,100).map(gameCard))
    else empty($('games'),'Sin partidos disponibles para la fecha seleccionada. No significa necesariamente que la API esté fallando.')
    txt('status','Fuente: '+result.source+' · '+result.date+'. Datos sujetos a cambios.')
    await reload(false)
  }catch(e){empty($('games'),e.message);txt('status','No hay datos deportivos confirmados. '+e.message)}
}
function renderOdds(){
  const el=$('odds');el.replaceChildren()
  if(!oddsRows.length){empty(el,'Sin cuotas para este mercado o periodo. Comprueba cobertura y temporada.');return}
  for(const o of oddsRows.slice(0,90)){
    const card=make('article',undefined,'odd')
    card.append(make('div',o.away+' vs '+o.home,'small'),make('strong',o.selection))
    const row=make('div',undefined,'row')
    row.append(make('span',o.market+(o.point!==null?' · '+o.point:'')),make('span',o.decimalOdds.toFixed(2),'price'))
    card.append(row,make('div',o.bookmaker+' · '+dateTime(o.updatedAt),'muted'))
    card.append(detailButton('Añadir al ticket',()=>addLeg(o)))
    el.append(card)
  }
}
async function loadOdds(){
  empty($('odds'),'Consultando mercado...')
  try{
    const q=new URLSearchParams({sportKey:$('oddsSport').value,markets:$('markets').value})
    const r=await api('/api/odds?'+q)
    oddsRows=r.odds;renderOdds()
    await reload(false)
  }catch(e){empty($('odds'),'No se pudieron obtener cuotas reales: '+e.message)}
}
function addLeg(o){
  if(legs.length>=12)return txt('ticketNote','Máximo 12 selecciones.')
  if(legs.some(l=>l.eventId===o.eventId&&l.market===o.market&&l.selection===o.selection&&l.point===o.point))return txt('ticketNote','Selección duplicada.')
  legs.push(o);renderTicket()
}
function renderTicket(){
  const box=$('legs');box.replaceChildren()
  if(!legs.length)box.append(make('div','Añade cuotas verificadas para calcular un boleto de prueba.','small'))
  for(const [index,l] of legs.entries()){
    const row=make('div',undefined,'ticket-item')
    const remove=make('button','×');remove.setAttribute('aria-label','Eliminar selección');remove.onclick=()=>{legs.splice(index,1);renderTicket()}
    row.append(remove,make('div',l.selection+' · '+l.market),make('div',l.bookmaker+' · '+l.decimalOdds.toFixed(2),'small'))
    box.append(row)
  }
  const product=legs.reduce((a,b)=>a*b.decimalOdds,1)
  txt('totalOdds',legs.length?product.toFixed(2):'—')
  txt('payout',legs.length?(product*(Number($('stake').value)||0)).toFixed(2):'—')
}
async function calculateTicket(){
  try{
    const r=await post('/api/ticket',{legs:legs.map(l=>({eventId:l.eventId,market:l.market,selection:l.selection,point:l.point,decimalOdds:l.decimalOdds})),stake:Number($('stake').value)})
    txt('ticketNote','Simulación · cuota '+r.ticket.decimalOdds+' · retorno bruto '+r.ticket.grossPotential+'. '+(r.ticket.correlationWarning||'Sin probabilidades calibradas no se calcula valor esperado. No se ha realizado ninguna apuesta.'))
  }catch(e){txt('ticketNote',e.message)}
}
async function discover(){
  try{
    const r=await post('/api/discover',{source:'espn',sport})
    txt('status','Descubiertas '+r.discovered+' ligas candidatas de '+sport+'. Se requiere aprobación explícita.')
    await reload()
  }catch(e){txt('status',e.message)}
}
async function reload(redraw=true){
  try{
    const result=await api('/api/catalog')
    catalog=result
    renderSources();renderCandidates()
    if(redraw){renderSports();renderOddsSports()}
  }catch(e){txt('status',e.message)}
}
$('date').value=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santo_Domingo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
$('refresh').onclick=loadGames
$('getOdds').onclick=loadOdds
$('discover').onclick=discover
$('quote').onclick=calculateTicket
$('clear').onclick=()=>{legs=[];renderTicket();txt('ticketNote','Ticket vacío.')}
$('stake').oninput=renderTicket
reload()

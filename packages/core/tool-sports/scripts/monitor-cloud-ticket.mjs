/** Cloud monitoring runs in GitHub Actions with the PC powered off.
 * The only persistent ticket record is AES-256-GCM ciphertext. Never print
 * decrypted tickets, emails, credentials or API request bodies.
 */
import {decryptCloudTicket,CLOUD_BODY_PREFIX,CLOUD_ISSUE_TITLE}
  from '../src/sports-cloud-ticket.ts'
import {gradeCloudLeg,summarizeCloudTicket} from '../src/sports-cloud-outcome.ts'
const env=process.env,repo=env.GITHUB_REPOSITORY||''
if(repo!=='arisnachy/phoenix-harnes')throw Error('Repositorio cloud inesperado')
const token=env.GITHUB_TOKEN||''
const key=env.PHOENIX_SPORTS_CLOUD_AES_KEY||''
const api='https://api.github.com/repos/'+repo
const allowed=Boolean(token&&key)
if(!allowed){console.log('Cloud no configurado: sin GITHUB_TOKEN o clave cifrada');process.exit(0)}
const github=async(path,options={})=>{
  const response=await fetch('https://api.github.com'+path,{
    ...options,headers:{Accept:'application/vnd.github+json',
      Authorization:'Bearer '+token,'X-GitHub-Api-Version':'2022-11-28',
      'User-Agent':'PHOENIX-Sports-Cloud',
      ...(options.headers||{})},
    signal:AbortSignal.timeout(10_000),redirect:'error',
  })
  if(!response.ok)throw Error('GitHub REST '+response.status)
  return response.status===204?null:await response.json()
}
const boards=new Map()
const scoreboard=async(sport,league,date)=>{
  const id=sport+'|'+league+'|'+date
  if(boards.has(id))return boards.get(id)
  const url='https://site.api.espn.com/apis/site/v2/sports/'+
    sport+'/'+league+'/scoreboard?dates='+date.replaceAll('-','')
  const response=await fetch(url,{signal:AbortSignal.timeout(8_000),redirect:'error'})
  if(!response.ok)throw Error('ESPN scoreboard '+response.status)
  const body=await response.json()
  if(!Array.isArray(body.events))throw Error('ESPN formato de scoreboard inválido')
  boards.set(id,body.events)
  return body.events
}
const findEvent=async leg=>{
  const next=new Date(Date.parse(leg.date+'T00:00:00Z')+86_400_000)
    .toISOString().slice(0,10)
  for(const day of [leg.date,next]){
    const events=await scoreboard(leg.sport,leg.league,day)
    const event=events.find(e=>String(e.id)===leg.eventId)
    if(event){
      // Scoreboard match is always keyed by exact ESPN ID and sport/league.
      // A different provider's ID is never substituted to fill missing data.
      if(leg.sport==='baseball'&&
        event.status?.type?.state==='post'&&
        !(event.competitions?.[0]?.competitors||[])
          .every(x=>(x.linescores||[]).length>=5)){
        try{
          const response=await fetch(
            'https://site.api.espn.com/apis/site/v2/sports/baseball/'+
            leg.league+'/summary?event='+leg.eventId,
            {signal:AbortSignal.timeout(8_000),redirect:'error'})
          if(response.ok){
            const data=await response.json()
            const match=(data.header?.competitions||[]).find(c=>
              String(c.id??c.uid??'')===leg.eventId)
            if(match?.competitors?.length===2&&
              match.competitors.every(x=>(x.linescores||[]).length>=5))
              return {...event,competitions:[match]}
          }
        }catch{/* Keep MLB unverified rather than count it as won. */}
      }
      return event
    }
  }
  return null
}
const mailConfig=Boolean(env.RESEND_API_KEY&&env.PHOENIX_SPORTS_NOTIFY_TO&&
  env.PHOENIX_SPORTS_NOTIFY_FROM)
const email=async(issue,ticket,summary,grades)=>{
  if(!mailConfig)return false
  const recipient=env.PHOENIX_SPORTS_NOTIFY_TO.trim()
  const sender=env.PHOENIX_SPORTS_NOTIFY_FROM.trim()
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(recipient)||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(sender))return false
  const label=summary.status==='won'?'ACERTÓ':
    summary.status==='lost'?'NO ACERTÓ':'PUSH / DEVOLUCIÓN'
  const message='PHOENIX Sports Intelligence\n'+
    'Ticket: '+ticket.reference+'\n'+
    'Resultado deportivo preliminar: '+label+'\n'+
    'Patas: '+grades.map((x,i)=>String(i+1)+'. '+
      ticket.legs[i].sport+' · '+ticket.legs[i].league+
      ' · evento '+x.eventId+' · '+x.result+
      (x.score?' · marcador '+x.score:'')).join('\n')+'\n\n'+
    'Este correo informa resultados deportivos públicos. No comprueba aceptación '+
    'del boleto, liquidación, pago, anulaciones ni reglas de la casa.'
  const response=await fetch('https://api.resend.com/emails',{
    method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,
      'Content-Type':'application/json',
      'Idempotency-Key':'phoenix-ticket-'+String(issue.id)+'-'+summary.status},
    body:JSON.stringify({from:sender,to:[recipient],
      subject:'PHOENIX · '+label+' (resultado deportivo provisional)',
      text:message}),
    signal:AbortSignal.timeout(10_000),redirect:'error',
  })
  if(!response.ok)throw Error('Proveedor de correo HTTP '+response.status)
  return true
}
let total=0,unresolved=0,emails=0,errors=0
for(let page=1;page<=4;page++){
  const issues=await github('/repos/'+repo+'/issues?state=open&per_page=100&page='+page)
  if(!Array.isArray(issues)||!issues.length)break
  for(const issue of issues){
    if(issue.pull_request||issue.title!==CLOUD_ISSUE_TITLE||
      typeof issue.body!=='string'||!issue.body.startsWith(CLOUD_BODY_PREFIX))
      continue
    total++
    try{
      const encrypted=issue.body.slice(CLOUD_BODY_PREFIX.length).trim()
      const ticket=decryptCloudTicket(encrypted,key)
      const grades=[]
      for(const leg of ticket.legs){
        let event=null
        try{event=await findEvent(leg)}catch{/* retry after transient outage */}
        grades.push(event?gradeCloudLeg(leg,event):{
          eventId:leg.eventId,result:'unverifiable',score:null,
          reason:'Evento o fuente ESPN no disponible en este ciclo',
        })
      }
      const summary=summarizeCloudTicket(grades)
      if(!summary.terminal){unresolved++;continue}
      if(!await email(issue,ticket,summary,grades)){unresolved++;continue}
      await github('/repos/'+repo+'/issues/'+issue.number,{
        method:'PATCH',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({state:'closed',state_reason:'completed'}),
      })
      emails++
    }catch(error){
      // Do not log decrypted ticket, response body, secret or recipient.
      errors++
      console.error('PHOENIX monitor issue '+Number(issue.number)+': '+
        (error instanceof Error?error.name:'UnknownError'))
    }
  }
  if(issues.length<100)break
}
console.log(JSON.stringify({checked:total,unresolved,emailsAccepted:emails,errors,
  emailConfigured:mailConfig,
  note:'Close only after accepted email and all official sporting outcomes; house settlement not verified.'}))

/** Autonomous, evidence-only, daily PHOENIX report (no wager execution).
 * Executes on GitHub Actions; no local PC or running PHOENIX instance needed.
 */
import {writeFile,appendFile} from 'node:fs/promises'
import {evidencePricedTicket} from '../src/evidence-priced-ticket.ts'
import {santoDomingoDay} from '../src/sports-daily-preload.ts'
import {formatDailyReport,dailyReportMarkdown} from './daily-ticket-format.mjs'
const env=process.env
const date=env.PHOENIX_PUBLISH_DATE||santoDomingoDay()
const slot=env.PHOENIX_PUBLISH_SLOT||'morning'
const count=Number(env.PHOENIX_PUBLISH_COUNT||'5')
if(!/^\d{4}-\d{2}-\d{2}$/u.test(date)||![5,6].includes(count)||
   !['morning','evening','manual'].includes(slot))
  throw Error('Parámetros de publicación inválidos')
const now=Date.now()
let ticket=null,error=null
try{
  ticket=await evidencePricedTicket(count,date,undefined,0,now,{
    ...env,PHOENIX_SPORTS_DAILY_PRELOAD_AUTO:'0',
  },fetch,undefined,'winner')
}catch(reason){
  // Never publish arbitrary transport error messages: URLs may contain provider keys.
  error=reason instanceof Error?reason.name:'Error en investigación'
}
const report=formatDailyReport(ticket,{
  date,slot,goal:count,checkedAt:new Date(now).toISOString(),error,
})
const markdown=dailyReportMarkdown(report)
await writeFile('phoenix-sports-daily-ticket.json',JSON.stringify(report,null,2)+'\n')
await writeFile('phoenix-sports-daily-ticket.md',markdown)
if(env.GITHUB_STEP_SUMMARY)await appendFile(env.GITHUB_STEP_SUMMARY,markdown.slice(0,18000)+'\n')
const recipient=env.PHOENIX_SPORTS_NOTIFY_TO?.trim()
const sender=env.PHOENIX_SPORTS_NOTIFY_FROM?.trim()
const mailReady=Boolean(env.RESEND_API_KEY&&recipient&&sender&&
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(recipient)&&
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(sender))
let delivery='artifact-only'
if(mailReady){
  try{
    const response=await fetch('https://api.resend.com/emails',{
      method:'POST',redirect:'error',
      headers:{Authorization:'Bearer '+env.RESEND_API_KEY,
        'Content-Type':'application/json',
        'Idempotency-Key':'phoenix-daily-'+date+'-'+slot},
      body:JSON.stringify({
        from:sender,to:[recipient],
        subject:'PHOENIX Sports · '+date+' · '+slot+' · '+report.status,
        text:markdown.slice(0,28000),
      }),
      signal:AbortSignal.timeout(12_000),
    })
    delivery=response.ok?'email-sent':'email-error-http-'+response.status
  }catch{delivery='email-error'}
}
console.log('PHOENIX DAILY PUBLICATION',JSON.stringify({
  date,slot,source:'public sports research',status:report.status,
  fixtures:report.discoveredEvents,priced:report.quotedLegs,
  legs:report.legs.length,delivery,
}))
if(!ticket)process.exitCode=1

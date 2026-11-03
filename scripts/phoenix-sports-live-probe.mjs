/**
 * Live ESPN endpoint smoke (GitHub Actions). No credentials and no write requests.
 * Failure is reported with the requested endpoint, not replaced with fake results.
 */
const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Santo_Domingo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()).replaceAll('-','')
const checks=[
  {name:'MLB scoreboard',url:'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?dates='+day,field:'events'},
  {name:'NBA scoreboard',url:'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates='+day,field:'events'},
  {name:'NFL scoreboard',url:'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates='+day,field:'events'},
  {name:'MLB teams',url:'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/teams',field:'sports'},
  {name:'NHL standings',url:'https://site.api.espn.com/apis/v2/sports/hockey/nhl/standings',field:'children'},
]
let failed=0
for(const item of checks){
  try{
    const response=await fetch(item.url,{headers:{accept:'application/json','user-agent':'PhoenixSportsProbe/1.0 (+public-source-verification)'},redirect:'error',signal:AbortSignal.timeout(12000)})
    if(!response.ok)throw new Error('HTTP '+response.status)
    const data=await response.json()
    const exists=Array.isArray(data[item.field])
    if(!exists)throw new Error('Expected array '+item.field+' absent, keys='+Object.keys(data).slice(0,8))
    console.log(JSON.stringify({name:item.name,ok:true,http:response.status,items:data[item.field].length,receivedAt:new Date().toISOString(),date:day}))
  }catch(error){
    failed++
    console.error(JSON.stringify({name:item.name,ok:false,error:String(error?.message||error),receivedAt:new Date().toISOString()}))
  }
}
if(failed)process.exitCode=1

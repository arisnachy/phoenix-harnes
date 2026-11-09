import {test} from 'node:test'
import assert from 'node:assert/strict'
import {validateCloudTicket,gradeCloudLeg,summarizeCloudTicket}
  from '../src/sports-cloud-outcome.ts'
const date='2026-11-09'
const leg=(sport,eventId,market='winner',selection='home',line)=>({
  sport,league:sport==='hockey'?'nhl':sport==='soccer'?'eng.1':
    sport==='baseball'?'mlb':sport==='tennis'?'atp':'nba',
  eventId,date,market,selection,...(line===undefined?{}:{line}),
})
const game=(id,state,home,away,detail='',withInnings=true)=>({
  id,status:{type:{state,detail}},competitions:[{competitors:[
    {homeAway:'home',score:String(home),winner:home>away,
      linescores:withInnings?Array.from({length:9},()=>({value:0})):[]},
    {homeAway:'away',score:String(away),winner:away>home,
      linescores:withInnings?Array.from({length:9},()=>({value:0})):[]},
  ]}],
})
test('remote sports result not sent until every fixture is officially finished',()=>{
 const partial=[
   gradeCloudLeg(leg('basketball','101'),game('101','post',125,100)),
   gradeCloudLeg(leg('basketball','102'),game('102','in',101,90)),
 ]
 assert.equal(partial[0].result,'won')
 assert.equal(partial[1].result,'pending')
 assert.equal(summarizeCloudTicket(partial).terminal,false)
})
test('five independent final winners give one provisional winning ticket outcome',()=>{
 const grades=Array.from({length:5},(_,i)=>gradeCloudLeg(
   leg('basketball',String(100+i)),game(String(100+i),'post',112,100)))
 const result=summarizeCloudTicket(grades)
 assert.equal(result.terminal,true)
 assert.equal(result.status,'won')
 assert.equal(result.won,5)
 assert.match(result.warning,/provisional/i)
})
test('one officially lost leg makes full finished ticket lost, without claiming payout',()=>{
 const grades=[
   gradeCloudLeg(leg('hockey','101'),game('101','post',4,2)),
   gradeCloudLeg(leg('hockey','102'),game('102','post',1,3)),
 ]
 assert.equal(summarizeCloudTicket(grades).status,'lost')
 assert.equal(summarizeCloudTicket(grades).terminal,true)
})
test('unknown extra-time soccer score cannot win 90-minute double chance',()=>{
 const status=gradeCloudLeg(leg('soccer','191','double_chance','1X'),
   game('191','post',2,1,'After Extra Time 120'))
 assert.equal(status.result,'unverifiable')
 assert.equal(summarizeCloudTicket([status]).terminal,false)
})
test('MLB missing innings cannot send false winner email',()=>{
 assert.equal(gradeCloudLeg(leg('baseball','200'),game('200','post',3,1,'',false))
   .result,'unverifiable')
 assert.equal(gradeCloudLeg(leg('baseball','200'),game('200','post',3,1))
   .result,'won')
})
test('same-game duplicates and unsupported periods are not enrolled in cloud monitor',()=>{
 const a=leg('basketball','123')
 const ticket={version:1,kind:'research',reference:'PHX-123',
   createdAt:'2026-11-09T10:00:00Z',legs:[a,a]}
 assert.throws(()=>validateCloudTicket(ticket),/duplicado/)
 assert.throws(()=>validateCloudTicket({...ticket,legs:[
   leg('soccer','124','double_chance','home'),
 ]}),/no verificable/)
})

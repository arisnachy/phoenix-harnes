import {test} from 'node:test'
import assert from 'node:assert/strict'
import {prioritizeNhlSkaters} from '../src/nhl-skater-impact.ts'
const p=(id,role='forward')=>({
  id:String(id),team:'SJS',name:'Player '+id,role,
  stats:{},last5:[],starterConfirmed:false,idProvider:'NHL',
})
test('official top scorer is researched first even if roster lists them last',()=>{
  const roster=[p(1),p(2),p(3),p(4,'defense'),p(5,'goalie')]
  const data={skaters:[
    {playerId:1,points:4,gamesPlayed:10,goals:1,assists:3,shots:12},
    {playerId:3,points:30,gamesPlayed:10,goals:12,assists:18,shots:46},
    {playerId:2,points:6,gamesPlayed:10,goals:3,assists:3,shots:15},
    {playerId:4,points:15,gamesPlayed:10,goals:5,assists:10,shots:20},
  ]}
  const r=prioritizeNhlSkaters(roster,data)
  assert.equal(r.matched,4)
  assert.equal(r.leaders[0].playerId,'3')
  assert.deepEqual(r.ranked.filter(x=>x.role==='forward').map(x=>x.id),['3','2','1'])
  assert.equal(r.leaders[0].points,30)
  assert.equal(r.leaders[0].goals,12)
  assert.equal(r.ranked.find(x=>x.role==='goalie').starterConfirmed,false)
})
test('reject foreign unrostered players and ESPN IDs never become NHL IDs',()=>{
  const r=prioritizeNhlSkaters([p(1),{...p(200),idProvider:'ESPN'}],{
    skaters:[{playerId:9000,points:99,gamesPlayed:10},
      {playerId:200,points:80,gamesPlayed:10},
      {playerId:1,points:10,gamesPlayed:10}]
  })
  assert.equal(r.matched,1)
  assert.deepEqual(r.leaders.map(x=>x.playerId),['1'])
})
test('failed or absent official club statistics preserves original research order',()=>{
  const roster=[p(21),p(22),p(23)]
  for(const value of [null,{}, {skaters:[{playerId:21,points:'NaN'}]}]){
    const r=prioritizeNhlSkaters(roster,value)
    assert.equal(r.matched,0)
    assert.deepEqual(r.ranked.map(x=>x.id),['21','22','23'])
  }
})

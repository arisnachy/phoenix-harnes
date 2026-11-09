import {test} from 'node:test'
import assert from 'node:assert/strict'
import {investigateEventDeep} from '../src/sports-deep-context.ts'

const now=Date.parse('2026-11-09T16:00:00Z')
const json=x=>new Response(JSON.stringify(x),{status:200,headers:{'content-type':'application/json'}})
const summary={
  header:{date:'2026-11-10T19:00:00Z',competitions:[{date:'2026-11-10T19:00:00Z',
    competitors:[
      {team:{id:'10',displayName:'Arsenal',abbreviation:'ARS'}},
      {team:{id:'11',displayName:'Chelsea',abbreviation:'CHE'}}]}]},
  gameInfo:{venue:{fullName:'Emirates Stadium',address:{city:'London'},
    location:{latitude:51.555,longitude:-0.108}}},
}
const feed=async url=>{
  const u=String(url)
  if(u.endsWith('/summary?event=201'))return json(summary)
  if(u.includes('news?limit='))return json({articles:[
    {headline:'Arsenal and Chelsea pregame report',description:'Arsenal vs Chelsea',
      published:'2026-11-09T14:30:00Z',
      links:{web:{href:'https://www.espn.com/soccer/story/_/id/123'}},
      images:[{url:'https://a.espncdn.com/photo/example.jpg'}]},
    {headline:'Arsenal and Chelsea unsafe link',description:'Arsenal vs Chelsea',
      published:'2026-11-09T15:00:00Z',
      links:{web:{href:'https://evil.example/story'}},
      images:[{url:'http://unsafe.example/asset.png'}]},
  ]})
  if(u.endsWith('/injuries'))return json({injuries:[]})
  if(u.includes('/roster'))return json({athletes:[]})
  if(u.includes('api.open-meteo.com/v1/forecast')){
    const q=new URL(u)
    assert.equal(q.searchParams.get('latitude'),'51.55500')
    return json({hourly:{time:['2026-11-10T18:00','2026-11-10T19:00'],
      temperature_2m:[8,9],wind_speed_10m:[17,22],
      precipitation_probability:[20,65]}})
  }
  return json({})
}
test('ESPN headline metadata, officiating absence and weather remain sourced',async()=>{
  const result=await investigateEventDeep('soccer','eng.1','201',feed,now)
  assert.equal(result.venue.name,'Emirates Stadium')
  assert.equal(result.venue.city,'London')
  assert.equal(result.officials.length,0)
  assert.equal(result.weather.status,'verified')
  assert.match(result.weather.description,/9\.0 °C/)
  assert.match(result.weather.description,/22\.0 km\/h/)
  assert.equal(result.headlines.length,2)
  assert.equal(result.headlines[0].articleUrl,'https://www.espn.com/soccer/story/_/id/123')
  assert.equal(result.headlines[0].imageUrl,'https://a.espncdn.com/photo/example.jpg')
  assert.equal(result.headlines[1].articleUrl,null)
  assert.equal(result.headlines[1].imageUrl,null)
})
test('indoor basketball never calls outdoor forecast even when coordinates exist',async()=>{
  let weatherCalls=0
  const basketball=async url=>{
    const u=String(url)
    if(u.includes('api.open-meteo.com'))weatherCalls++
    if(u.includes('/summary?'))return json(summary)
    if(u.endsWith('/injuries'))return json({injuries:[]})
    if(u.includes('/roster'))return json({athletes:[]})
    return json({articles:[]})
  }
  const report=await investigateEventDeep('basketball','nba','201',basketball,now)
  assert.equal(report.weather.status,'not-applicable')
  assert.equal(weatherCalls,0)
})
test('missing venue coordinates are not silently geocoded or assigned weather',async()=>{
  const noCoords=async url=>{
    const u=String(url)
    if(u.includes('api.open-meteo.com'))throw Error('Unexpected weather request')
    if(u.includes('/summary?'))return json({header:summary.header,
      gameInfo:{venue:{fullName:'Unknown Stadium',address:{city:'London'}}}})
    if(u.endsWith('/injuries'))return json({injuries:[]})
    return json({athletes:[]})
  }
  const report=await investigateEventDeep('soccer','eng.1','201',noCoords,now)
  assert.equal(report.weather.status,'unavailable')
})

/**
 * Exploratory PHOENIX pregame score model. Inputs MUST be finished matches
 * observed before kickoff. It is deliberately NOT a trained/calibrated model:
 * do not advertise expected value, a profitable edge or winning tickets.
 */
export type FinishedGame={scored:number;allowed:number;date:string}
export type ForecastSide={name:string;lastGames:readonly FinishedGame[]}
export type ForecastInput={
  sport:string;phase:string;eventDate:string;home:ForecastSide;away:ForecastSide
}
export type ForecastResult={
  status:'exploratory'|'insufficient'|'not-pregame'
  model:'recent-form-poisson-v1'|'recent-margin-logistic-v1'|null
  probabilityHome:number|null
  probabilityAway:number|null
  probabilityDraw:number|null
  projectedHome:number|null
  projectedAway:number|null
  homeSample:number;awaySample:number
  calibrated:false
  eligibleForValueBet:false
  warnings:string[]
}
const cap=(value:number,low:number,high:number)=>Math.max(low,Math.min(high,value))
const round=(value:number)=>Number(value.toFixed(4))
const mean=(numbers:readonly number[])=>numbers.reduce((sum,n)=>sum+n,0)/numbers.length
const valid=(game:FinishedGame,kickoff:number)=>Number.isFinite(game.scored)&&
  Number.isFinite(game.allowed)&&game.scored>=0&&game.allowed>=0&&
  game.scored<=300&&game.allowed<=300&&
  Number.isFinite(Date.parse(game.date))&&Date.parse(game.date)<kickoff
const recent=(games:readonly FinishedGame[],kickoff:number)=>games
  .filter(game=>valid(game,kickoff))
  .sort((a,b)=>Date.parse(b.date)-Date.parse(a.date))
  .slice(0,8)
const poisson=(mu:number,max:number):number[]=>{
  const probabilities=[Math.exp(-mu)]
  for(let k=1;k<=max;k++)probabilities.push(probabilities[k-1]! *mu/k)
  return probabilities
}
const logistic=(value:number)=>1/(1+Math.exp(-cap(value,-40,40)))
/**
 * Returns a deliberately conservative descriptive forecast. No trained model
 * artifacts, calibration curves or sportsbook odds are consumed here.
 */
export function estimateEvidenceForecast(input:ForecastInput,now=Date.now()):ForecastResult{
  const kickoff=Date.parse(input.eventDate)
  const home=Number.isFinite(kickoff)?recent(input.home.lastGames,kickoff):[]
  const away=Number.isFinite(kickoff)?recent(input.away.lastGames,kickoff):[]
  const initial:ForecastResult={
    status:'insufficient',model:null,probabilityHome:null,probabilityAway:null,
    probabilityDraw:null,projectedHome:null,projectedAway:null,
    homeSample:home.length,awaySample:away.length,calibrated:false,
    eligibleForValueBet:false,warnings:[],
  }
  if(input.phase!=='pre'||!Number.isFinite(kickoff)||kickoff<=now){
    return {...initial,status:'not-pregame',
      warnings:['El evento ya comenzó, terminó o no tiene fecha futura verificable.']}
  }
  if(home.length<5||away.length<5){
    return {...initial,warnings:['Se requieren al menos cinco encuentros finalizados por equipo anteriores al partido.',
      'No extrapolar probabilidades a partir de pocos resultados.']}
  }
  const hf=mean(home.map(g=>g.scored)),ha=mean(home.map(g=>g.allowed))
  const af=mean(away.map(g=>g.scored)),aa=mean(away.map(g=>g.allowed))
  const projectedHome=cap((hf+aa)/2,0,300)
  const projectedAway=cap((af+ha)/2,0,300)
  const warnings=[
    'Proyección exploratoria SIN calibración ni prueba retrospectiva fuera de muestra: NO demuestra ventaja sobre las cuotas.',
    'No ajusta fuerza de rivales, bajas, titulares, calendario, localía ni correlación entre anotaciones.',
    'No usar estas probabilidades para calcular EV, afirmar rentabilidad ni recomendar apuestas automáticas.',
  ]
  if(input.sport==='soccer'){
    // Scoreline independence is a simplifying assumption, not a trained model.
    const h=poisson(cap(projectedHome,0.05,8),35)
    const a=poisson(cap(projectedAway,0.05,8),35)
    let ph=0,pa=0,pd=0
    for(let i=0;i<h.length;i++)for(let j=0;j<a.length;j++){
      const p=h[i]!*a[j]!
      if(i>j)ph+=p
      else if(i<j)pa+=p
      else pd+=p
    }
    const total=ph+pa+pd
    if(!Number.isFinite(total)||total<=0)return {...initial,warnings:['No se pudo normalizar el modelo de goles.']}
    return {...initial,status:'exploratory',model:'recent-form-poisson-v1',
      projectedHome:round(projectedHome),projectedAway:round(projectedAway),
      probabilityHome:round(ph/total),probabilityAway:round(pa/total),
      probabilityDraw:round(pd/total),warnings}
  }
  if(!['basketball','football','baseball','hockey'].includes(input.sport)){
    return {...initial,projectedHome:round(projectedHome),projectedAway:round(projectedAway),
      warnings:['No hay modelo de resultado permitido para esta disciplina.']}
  }
  const margins=[...home.map(g=>g.scored-g.allowed),
    ...away.map(g=>g.allowed-g.scored)]
  const marginAverage=mean(margins)
  const variance=mean(margins.map(v=>(v-marginAverage)**2))
  // Floor guards tiny samples against near-certain probabilities.
  const minimumScale:Record<string,number>={basketball:12,football:7,baseball:3,hockey:2}
  const scale=Math.max(Math.sqrt(variance),minimumScale[input.sport]??8)
  const ph=cap(logistic((projectedHome-projectedAway)/scale),0.05,0.95)
  return {...initial,status:'exploratory',model:'recent-margin-logistic-v1',
    projectedHome:round(projectedHome),projectedAway:round(projectedAway),
    probabilityHome:round(ph),probabilityAway:round(1-ph),probabilityDraw:null,
    warnings:[...warnings,'La aproximación logística no modela empates, overtime ni liquidación por período.']}
}

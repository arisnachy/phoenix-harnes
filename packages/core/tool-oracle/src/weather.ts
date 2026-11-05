/**
 * Weather-specific evidence adapter. Uses live API values, not search snippets.
 * A deterministic forecast is NOT a calibrated probability of crossing a threshold.
 */
import type { WebRuntime } from '@phoenix-ai/dsh-web'
export interface OracleWeatherForecast {
  kind:'oracle_weather_forecast'
  status:'forecast'|'insufficient'
  place:string
  country:string
  date:string
  thresholdC?:number
  expectedMaxC?:number
  exceedsThreshold?:boolean
  daily:Array<{date:string;maxC:number}>
  provider:'Open-Meteo'
  source:string
  checkedAt:string
  evidenceStatus:'model_output_unverified'
  probabilityPercent:null
  reason?:string
}
function parseJson(res:{statusCode:number;truncated:boolean;body:{kind:'html'|'text';content:string}},label:string):Record<string,unknown>{
  if(res.statusCode!==200||res.truncated||res.body.kind!=='text'||res.body.content.length>350000)
    throw new Error(label+': respuesta incompleta, error HTTP o formato inesperado.')
  const obj:unknown=JSON.parse(res.body.content)
  if(!obj||typeof obj!=='object'||Array.isArray(obj))throw new Error(label+': JSON inválido.')
  return obj as Record<string,unknown>
}
function dateOnly(v:string):boolean{return /^\d{4}-\d{2}-\d{2}$/u.test(v)&&!Number.isNaN(Date.parse(v+'T00:00:00Z'))}
export async function forecastOracleWeather(web:Pick<WebRuntime,'fetch'>,args:{
  location:string;date:string;countryCode?:string;thresholdC?:number
},signal?:AbortSignal):Promise<OracleWeatherForecast>{
  if(typeof args.location!=='string'||args.location.trim().length<2||args.location.length>120)
    throw new Error('Indicar ciudad y país de la consulta meteorológica.')
  if(typeof args.date!=='string'||!dateOnly(args.date))throw new Error('Usar fecha local YYYY-MM-DD.')
  if(args.countryCode!==undefined&&!/^[A-Z]{2}$/u.test(args.countryCode))throw new Error('Código ISO de país de dos letras.')
  if(args.thresholdC!==undefined&&(!Number.isFinite(args.thresholdC)||args.thresholdC < -100||args.thresholdC > 100))
    throw new Error('Umbral °C no válido.')
  const name=args.location.split(',')[0]!.trim()
  const countryCode=args.countryCode
    ??(/rep[uú]blica dominicana|dominican republic|dominicana/iu.test(args.location)?'DO':undefined)
  const geoUrl='https://geocoding-api.open-meteo.com/v1/search?name='+encodeURIComponent(name)+'&count=10&language=es&format=json'
  const placeResponse=parseJson(await web.fetch({url:geoUrl},signal),'Geocodificación')
  const locations=Array.isArray(placeResponse.results)?placeResponse.results:[]
  const options=locations.filter((v):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v))
  const valid=options.filter(v=>Number.isFinite(v.latitude)&&Number.isFinite(v.longitude)
    &&typeof v.name==='string'&&typeof v.country_code==='string')
  const preferred=countryCode?valid.filter(v=>v.country_code===countryCode):valid
  const city=preferred[0]
  if(!city)throw new Error('No se encontró una ubicación geográfica que corresponda al país indicado.')
  const latitude=Number(city.latitude),longitude=Number(city.longitude)
  if(Math.abs(latitude)>90||Math.abs(longitude)>180)throw new Error('Coordenadas geográficas fuera de rango.')
  const forecastUrl='https://api.open-meteo.com/v1/forecast?latitude='+latitude+
    '&longitude='+longitude+'&daily=temperature_2m_max&timezone=auto&forecast_days=16&temperature_unit=celsius'
  const weather=parseJson(await web.fetch({url:forecastUrl},signal),'Pronóstico Open-Meteo')
  const daily=weather.daily
  if(!daily||typeof daily!=='object'||Array.isArray(daily))throw new Error('Pronóstico no ofrece variables diarias.')
  const d=daily as Record<string,unknown>
  if(!Array.isArray(d.time)||!Array.isArray(d.temperature_2m_max)||d.time.length!==d.temperature_2m_max.length)
    throw new Error('Pronóstico diario sin valores de temperatura emparejados.')
  const points:Array<{date:string;maxC:number}>=[]
  for(let i=0;i<d.time.length;i++){
    const date=d.time[i],max=d.temperature_2m_max[i]
    if(typeof date!=='string'||!dateOnly(date)||typeof max!=='number'||!Number.isFinite(max)||max< -100||max>100)
      continue
    points.push({date,maxC:max})
  }
  const target=points.find(p=>p.date===args.date)
  const base:OracleWeatherForecast={
    kind:'oracle_weather_forecast',status:target?'forecast':'insufficient',
    place:String(city.name),country:String(city.country??city.country_code),
    date:args.date,daily:points.slice(0,16),provider:'Open-Meteo',source:forecastUrl,
    checkedAt:new Date().toISOString(),evidenceStatus:'model_output_unverified',probabilityPercent:null,
    ...(args.thresholdC!==undefined?{thresholdC:args.thresholdC}:{}),
  }
  if(!target)return {...base,reason:'No existe pronóstico diario del proveedor para esa fecha. Consultar fuentes oficiales o esperar a que entre en el horizonte disponible.'}
  return {...base,expectedMaxC:target.maxC,
    ...(args.thresholdC!==undefined?{exceedsThreshold:target.maxC>args.thresholdC}:{})}
}

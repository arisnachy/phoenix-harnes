/** WHO ICD-11 MMS exact stem-code lookup. No patient context is accepted. */
export const ICD11_RELEASE='2026-01'
const root='https://id.who.int/icd/release/11/'+ICD11_RELEASE+'/mms'
const tokenEndpoint='https://icdaccessmanagement.who.int/connect/token'
export type Icd11Verification={code:string;release:string;source:string;verifiedAt:string;entity:string}
export async function verifyIcd11Code(input:unknown,credentials:{clientId?:string;clientSecret?:string},request:typeof fetch=fetch):Promise<Icd11Verification>{
  if(typeof input!=='string'||!/^[0-9A-Z]{4,7}(?:\.[0-9A-Z]{1,4})?$/u.test(input))throw Error('Código simple CIE-11 inválido')
  if(!credentials.clientId||!credentials.clientSecret)throw Error('Credenciales OMS no configuradas')
  const tokenResponse=await request(tokenEndpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(8000),
    headers:{authorization:'Basic '+Buffer.from(credentials.clientId+':'+credentials.clientSecret).toString('base64'),
      'content-type':'application/x-www-form-urlencoded',accept:'application/json'},
    body:new URLSearchParams({grant_type:'client_credentials',scope:'icdapi_access'})})
  if(!tokenResponse.ok)throw Error('Autenticación OMS no confirmada')
  const token=await tokenResponse.json() as {access_token?:unknown}
  if(typeof token.access_token!=='string'||!token.access_token)throw Error('Token OMS no confirmado')
  const source=root+'/codeinfo/'+encodeURIComponent(input)
  const response=await request(source,{redirect:'error',signal:AbortSignal.timeout(8000),
    headers:{authorization:'Bearer '+token.access_token,accept:'application/json','accept-language':'es','API-Version':'v2'}})
  if(!response.ok)throw Error('Código no verificado por la OMS')
  const data=await response.json() as {code?:unknown;stemCode?:unknown;stemId?:unknown}
  if(data.code!==input||data.stemCode!==input||typeof data.stemId!=='string'
    ||!new RegExp('^https?://id\\.who\\.int/icd/release/11/'+ICD11_RELEASE+'/mms/[0-9]+(?:/[a-z]+)?$','u').test(data.stemId))
    throw Error('Respuesta de codificación OMS no verificable')
  return {code:input,release:ICD11_RELEASE,source,verifiedAt:new Date().toISOString(),entity:data.stemId}
}

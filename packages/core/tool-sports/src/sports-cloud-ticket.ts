/** Enqueue encrypted sports ticket on GitHub's always-on issues ledger.
 * No leg, identity, wager or email is exposed publicly. In a public repo
 * only ciphertext and a generic subject are visible. Fully opt-in.
 */
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto'
import {validateCloudTicket,type CloudTicket} from './sports-cloud-outcome.ts'
const REPO='arisnachy/phoenix-harnes'
export const CLOUD_ISSUE_TITLE='[PHOENIX-CLOUD-V1] Encrypted sports ticket'
export const CLOUD_BODY_PREFIX='PHOENIX-CLOUD-CIPHERTEXT-V1\n'
const secret=(encoded:string)=>{
  if(!/^[A-Za-z0-9_-]{43,44}$/u.test(encoded))throw Error('Clave AES-GCM inválida')
  const bytes=Buffer.from(encoded,'base64url')
  if(bytes.length!==32)throw Error('La clave debe contener 32 bytes')
  return bytes
}
/** Only a 256-bit random shared key, no passwords or secrets embedded in code. */
export function encryptCloudTicket(ticket:CloudTicket,encodedKey:string):string{
  const safe=validateCloudTicket(ticket)
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',secret(encodedKey),iv)
  const body=Buffer.concat([cipher.update(JSON.stringify(safe),'utf8'),cipher.final()])
  return Buffer.concat([iv,cipher.getAuthTag(),body]).toString('base64url')
}
/** The cloud worker verifies GCM authentication BEFORE parsing the ticket. */
export function decryptCloudTicket(payload:string,encodedKey:string):CloudTicket{
  if(!/^[A-Za-z0-9_-]{40,30000}$/u.test(payload))
    throw Error('Sobre de ticket cifrado inválido')
  const raw=Buffer.from(payload,'base64url')
  if(raw.length<29||raw.length>20_000)throw Error('Tamaño de ticket inválido')
  const decipher=createDecipheriv('aes-256-gcm',secret(encodedKey),raw.subarray(0,12))
  decipher.setAuthTag(raw.subarray(12,28))
  const json=Buffer.concat([decipher.update(raw.subarray(28)),decipher.final()])
  return validateCloudTicket(JSON.parse(json.toString('utf8')) as unknown)
}
export type CloudEnrollment={
  status:'disabled'|'needs-configuration'|'enqueued'|'error'
  issueNumber:number|null
  reason:string
}
/** Must be invoked by the trusted Host only, never a model-provided URL. */
export async function enrollCloudTicket(ticket:CloudTicket,
  env:NodeJS.ProcessEnv=process.env,transport:typeof fetch=fetch,
):Promise<CloudEnrollment>{
  if(env.PHOENIX_SPORTS_CLOUD_TRACKING_ENABLED!=='1')
    return{status:'disabled',issueNumber:null,
      reason:'Seguimiento remoto opcional desactivado; no hay correo automático.'}
  const key=env.PHOENIX_SPORTS_CLOUD_AES_KEY?.trim()
  const githubToken=env.PHOENIX_SPORTS_CLOUD_GITHUB_TOKEN?.trim()
  if(!key||!githubToken)return{status:'needs-configuration',issueNumber:null,
    reason:'Faltan clave AES-256 o token de GitHub Issues en la bóveda. No se publicó ningún ticket.'}
  try{
    const ciphertext=encryptCloudTicket(ticket,key)
    const response=await transport('https://api.github.com/repos/'+REPO+'/issues',{
      method:'POST',
      headers:{Authorization:'Bearer '+githubToken,
        Accept:'application/vnd.github+json','Content-Type':'application/json',
        'X-GitHub-Api-Version':'2022-11-28','User-Agent':'PHOENIX-Sports-Monitor'},
      body:JSON.stringify({title:CLOUD_ISSUE_TITLE,body:CLOUD_BODY_PREFIX+ciphertext}),
      signal:AbortSignal.timeout(10_000),
      redirect:'error',
    })
    if(response.status!==201)throw Error('GitHub Issues HTTP '+response.status)
    const issue=await response.json() as Record<string,unknown>
    if(typeof issue.number!=='number'||!Number.isInteger(issue.number)||issue.number<1)
      throw Error('Issue de monitorización no confirmada')
    return{status:'enqueued',issueNumber:Number(issue.number),
      reason:'Boleto cifrado registrado en GitHub. Correo condicionado a la ejecución '
      +'de la tarea cloud y la configuración de Resend; no implica apuesta aceptada.'}
  }catch{
    // Never include the token, ciphertext, provider error body or ticket in
    // model-visible errors and browser logs.
    return{status:'error',issueNumber:null,
      reason:'No se confirmó el registro remoto. El ticket local permanece visible.'}
  }
}

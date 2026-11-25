/** Narrow deny-only guard for nonclinical Living action payloads. This is not
 * a general prompt-injection detector or DLP system. Never return input data. */
export function livingActionSafety(value:unknown):boolean{
  let remaining=256
  const walk=(v:unknown,depth:number):boolean=>{
    if(--remaining<0||depth>12)return false
    if(v===null||typeof v==='boolean')return true
    if(typeof v==='number')return Number.isFinite(v)
    if(typeof v==='string')return !/(?:https?:\/\/|phoenix-control:\/\/|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:Bearer\s+\S+|sk-(?:proj-)?[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_]{16,}|xox[baprs]-[A-Za-z0-9-]{12,})|[\u0000-\u0008\u000b\u000c\u000e-\u001f])/iu.test(v)
    if(Array.isArray(v))return v.every(x=>walk(x,depth+1))
    if(typeof v!=='object')return false
    return Object.entries(v).every(([key,x])=>! /^(?:__proto__|constructor|prototype|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|secret|credential|patient[_-]?id|patient[_-]?name|medical[_-]?record|shell[_-]?command|raw[_-]?command)$/iu.test(key)&&walk(x,depth+1))
  }
  return walk(value,0)
}

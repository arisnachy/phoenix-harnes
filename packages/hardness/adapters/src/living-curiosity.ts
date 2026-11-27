import { createHash } from 'node:crypto'
import type { ProactivityTask } from './proactivity-engine.ts'
import type { ProactivityAttentionItem } from './proactivity-runtime.ts'

const MINUTE = 60_000
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex')

/** Identify recurring objectives that repeatedly failed without an existing custom alert.
 * Only visible, user-originated work is considered; no instructions or errors are exposed.
 * @param tasks - Already-loaded durable task projection.
 * @param now - Current wall clock.
 * @returns At most one actionable curiosity signal with a stable durable receipt key.
 */
export function curiosityAttention(tasks: readonly ProactivityTask[], now: number): ProactivityAttentionItem[] {
  const candidates: ProactivityAttentionItem[] = []
  for (const task of tasks) {
    if (task.visibility !== 'visible' || task.createdBy !== 'user' || task.delivery !== 'work'
      || task.recurrence.kind === 'once' || task.attentionMode === 'off' || task.attentionText !== undefined
      || task.status === 'paused' || task.status === 'cancelled' || task.status === 'completed' || task.status === 'running') continue
    const seen = new Set<string>()
    const failed: string[] = []
    let lastFailure: string | undefined
    for (const row of [...task.history].reverse()) {
      const finished = Date.parse(row.finishedAt)
      if (row.phase !== 'deliver' || !Number.isFinite(finished) || finished > now || now - finished > 7*24*60*MINUTE) continue
      if (seen.has(row.scheduledFor)) continue
      seen.add(row.scheduledFor)
      if (row.status === 'completed') break
      lastFailure ??= row.finishedAt
      failed.push(row.scheduledFor)
      if (failed.length === 3) break
    }
    if (failed.length < 2 || lastFailure === undefined) continue
    candidates.push({id:'living:curiosity:'+task.id,taskId:task.id,revision:hash([task.id,failed]),kind:'failure',
      title:'Objetivo recurrente necesita revisión',
      detail:'Se detectaron fallos en distintas ejecuciones de un objetivo autorizado. Conviene investigar la causa antes de reintentar.',
      at:lastFailure,score:86})
  }
  return candidates.sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)||a.id.localeCompare(b.id)).slice(0,1)
}

type Device = {readonly entityId:string;readonly state:string}
type ReadHome = (signal:AbortSignal)=>Promise<readonly Device[]|undefined>

/** Optional read-only home observation, piggybacking on the existing Host scheduler.
 * No actions, device attributes, raw names, model calls or additional interval.
 */
export class LivingHomeAttention {
  private next = 0
  private running: AbortController | undefined
  private stopped = false
  private signature: string | undefined
  private samples = 0
  private baseline = false
  private item: ProactivityAttentionItem | undefined
  private observedAt = 0
  constructor(private readonly readHome:ReadHome, private readonly now:()=>number=Date.now) {}

  /** Observe configured allowlisted devices with a bounded deadline.
   * @returns Promise of the sampling cycle, independently of scheduled model work.
   */
  async observe():Promise<void>{
    const now=this.now()
    if(this.stopped||this.running||now<this.next)return
    this.next=now+MINUTE
    const controller=new AbortController()
    this.running=controller
    try{
      const rows=await this.readHome(AbortSignal.any([controller.signal,AbortSignal.timeout(5000)]))
      if(this.stopped||controller.signal.aborted)return
      if(rows===undefined){this.reset();return}
      const unavailable=[...new Set(rows.filter(row=>row.state==='unavailable'||row.state==='unknown').map(row=>row.entityId))].sort()
      const signature=hash(unavailable)
      const count=unavailable.length
      this.observedAt=this.now()
      if(!this.baseline){
        this.baseline=true
        this.signature=signature
        this.samples=1
        return
      }
      if(this.signature!==signature){this.signature=signature;this.samples=1;this.item=undefined}
      else this.samples++
      if(count===0){this.item=undefined;return}
      if(this.samples>=2&&this.item===undefined){
        const at=new Date(this.observedAt).toISOString()
        this.item={id:'living:home-availability',taskId:'living:home-availability',revision:hash([signature,at]),kind:'result',
          title:'Dispositivos domóticos sin estado disponible',
          detail:count+' dispositivo(s) autorizados no informan un estado disponible en dos observaciones. No se modificó ningún equipo.',
          at,score:72}
      }
    }catch{this.reset()}finally{if(this.running===controller)this.running=undefined}
  }
  private reset():void{this.baseline=false;this.samples=0;this.signature=undefined;this.item=undefined;this.observedAt=0}
  /** Return only a fresh aggregate observation.
   * @returns Current home attention row or an empty list.
   */
  read():ProactivityAttentionItem[]{return this.item&&this.now()-this.observedAt<=2*MINUTE?[this.item]:[]}
  /** Cancel outstanding work on Host shutdown. */
  dispose():void{this.stopped=true;this.running?.abort();this.reset()}
}

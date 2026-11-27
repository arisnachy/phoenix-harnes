import { freemem, totalmem } from 'node:os'
import { randomUUID } from 'node:crypto'
import type { ProactivityAttentionItem } from './proactivity-runtime.ts'

/** A local material resource episode, projected through the existing home attention channel.
 * No new poller, model request, private content, or automatic system change.
 */
export class LivingResourceAttention {
  private episode: { revision: string; started: number; confirmed: boolean } | undefined
  constructor(
    private readonly memory: () => { free: number; total: number } = () => ({ free: freemem(), total: totalmem() }),
    private readonly now: () => number = Date.now,
  ) {}

  /** Read host memory and emit only a sustained critical episode, preserving its acknowledgement revision.
   * @returns At most one existing attention-feed row.
   */
  read(): ProactivityAttentionItem[] {
    const { free, total } = this.memory()
    const now = this.now()
    if (!Number.isFinite(free) || !Number.isFinite(total) || total <= 0 || free < 0 || free > total) return []
    const ratio = free / total
    if (ratio >= 0.12) { this.episode = undefined; return [] }
    if (ratio >= 0.08 && !this.episode?.confirmed) { this.episode = undefined; return [] }
    if (this.episode === undefined) this.episode = { revision: randomUUID(), started: now, confirmed: false }
    if (!this.episode.confirmed && now - this.episode.started < 60_000) return []
    this.episode.confirmed = true
    return [{
      id: 'living:resource-memory',
      taskId: 'living:resource-memory',
      revision: this.episode.revision,
      kind: 'result',
      title: 'Memoria disponible reducida',
      detail: 'El sistema detectó presión sostenida de memoria. Conviene revisar recursos antes de iniciar tareas pesadas.',
      at: new Date(this.episode.started).toISOString(),
      score: 70,
    }]
  }
}

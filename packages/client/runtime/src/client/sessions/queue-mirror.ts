import type { ContentBlock } from '@phoenix-ai/dsh-llm/types'
import type { MuxFrame } from '@phoenix-ai/dsh-api-remotes/client'
import type { SessionEvent } from '@phoenix-ai/dsh-session/types'
import type { QueuedMessage } from './conversation.ts'

const QUEUE_PREVIEW_CHARS = 200

function previewOf(content: readonly ContentBlock[]): string {
  const flat = content
    .map(block => (block.type === 'text' ? block.text : `[${block.type}]`))
    .join(' ').replace(/\s+/g, ' ').trim()
  const chars = Array.from(flat)
  return chars.length > QUEUE_PREVIEW_CHARS ? `${chars.slice(0, QUEUE_PREVIEW_CHARS).join('')}…` : flat
}

function textOf(content: readonly ContentBlock[]): string | null {
  if (!content.every(block => block.type === 'text')) return null
  return content.map(block => block.text).join('')
}

type QueueItems = Extract<MuxFrame, { type: 'session/queue' }>['items']

/** Authoritative transient queue projection and durable steering handoff. */
export class SessionQueueMirror {
  private current: readonly QueuedMessage[] = []

  snapshot(): readonly QueuedMessage[] {
    return this.current
  }

  reset(): boolean {
    if (this.current.length === 0) return false
    this.current = []
    return true
  }

  replace(items: QueueItems, anchorSeq: number | null = null): void {
    const previousAnchors = new Map(
      this.current.map(item => [String(item.messageId), item.anchorSeq] as const),
    )
    const byMessage = new Map<string, QueuedMessage>()
    for (const item of items) {
      const messageKey = String(item.message.id)
      const candidate: QueuedMessage = {
        id: item.id,
        messageId: item.message.id,
        placement: item.placement,
        anchorSeq: previousAnchors.get(messageKey) ?? anchorSeq,
        content: item.message.content,
        preview: previewOf(item.message.content),
        text: textOf(item.message.content),
      }
      const existing = byMessage.get(messageKey)
      if (existing === undefined) {
        byMessage.set(messageKey, candidate)
        continue
      }
      const rank = { context: 0, queued: 1, steering: 2 } as const
      if (rank[candidate.placement] > rank[existing.placement]) byMessage.set(messageKey, candidate)
    }
    this.current = [...byMessage.values()]
  }

  acceptDurable(event: SessionEvent): boolean {
    if (event.type !== 'user/message') return false
    const messageId = event.data.id
    const next = this.current.filter(item =>
      !(item.placement === 'steering' && item.messageId === messageId))
    if (next.length === this.current.length) return false
    this.current = next
    return true
  }
}

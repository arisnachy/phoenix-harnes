/** Reply context belongs above the existing main composer, never in a second chat. */
import type { InjectFace, PropsLocale, PropsRuntime } from '@phoenix-ai/dsh-client-ui-slots'
import css from './TeamChatMessage.module.css'
import { NS } from './locales.ts'
export interface TeamReplyChoice {
  readonly messageId: string
  readonly authorId: string
  readonly name: string
  readonly preview: string
}
export interface TeamReplyDockInjected {
  readonly hooks: { readonly replyChoice: { subscribe(listener: () => void): () => void; getSnapshot(): TeamReplyChoice | undefined } }
  readonly clearReply: () => void
}
export function TeamReplyDock({ useReplyChoice, clearReply, t }: PropsRuntime<'conversation.input.dock'> & InjectFace<TeamReplyDockInjected> & PropsLocale<typeof NS>) {
  const selected = useReplyChoice(value => value)
  if (selected === undefined) return null
  return <div data-team-reply-context className={css.replyContext}>
    <strong>{t('chat.replyingTo', { name: selected.name })}</strong>
    <blockquote>{selected.preview}</blockquote>
    <button type="button" onClick={clearReply} aria-label={t('chat.cancelReply')}>×</button>
  </div>
}

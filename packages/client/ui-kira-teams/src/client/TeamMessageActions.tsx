/** Emoji reactions for every ordinary or team message in the same transcript. */
import { lazy, Suspense, useEffect, useRef, useState, type ComponentProps } from 'react'
import type { PropsLocale, PropsRuntime } from '@phoenix-ai/dsh-client-ui-slots'
import type {} from '@phoenix-ai/dsh-agent-team/chat-types'
import { KIRA_ROSTER } from './KiraTeamsDock.tsx'
import { teamIdentityOf } from './TeamChatMessage.tsx'
import { ModelActivityAvatar } from './ModelActivityAvatar.tsx'
import { NS } from './locales.ts'
import css from './TeamChatMessage.module.css'
const EmojiPicker = lazy(async () => {
  const module = await import('emoji-picker-react')
  // The single-file plugin loader wraps CommonJS exports in an ESM namespace.
  const exported: unknown = module.default
  const Picker = (typeof exported === 'object' && exported !== null && 'default' in exported
    ? exported.default : exported) as typeof module.default
  return { default: function NativePicker(props: ComponentProps<typeof module.default>) {
    return <Picker {...props} emojiStyle={module.EmojiStyle.NATIVE} />
  } }
})
const QUICK = ['👍', '❤️', '😂', '😮', '😢', '😡', '👀', '✅', '🎉', '🔥', '🤔', '💡', '👏', '🙌', '🚀', '💯']

function AddReactionIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
      <path d="M15.8 7.4A7.5 7.5 0 1 0 18.5 13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M7.7 14.1c.9 1.1 2.1 1.7 3.5 1.7 1.5 0 2.8-.7 3.7-1.9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="8.5" cy="10.2" r="1" fill="currentColor" />
      <circle cx="13.8" cy="10.2" r="1" fill="currentColor" />
      <path d="M19 2.5v5M16.5 5h5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}
export interface TeamMessageActionsInjected {
  react: (messageId: string, emoji: string, active: boolean) => Promise<void>
  reply: (messageId: string, authorId: string, authorName: string, preview: string) => void
}
type Props = PropsRuntime<'conversation.chat.message-actions'> & TeamMessageActionsInjected & PropsLocale<typeof NS>
export function TeamMessageActions({
  messageId, authorId, authorKind, authorName, replyPreview, originMissionId, sessionId, useProjection, react, reply, t,
}: Props) {
  const reactionProjection = useProjection('teamChatReactions')
  const reactions = reactionProjection?.[messageId] ?? []
  const previous = useRef<Set<string> | undefined>(undefined)
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  useEffect(() => {
    if (reactionProjection === undefined) return
    const received = new Set(reactions.map(item => item.id))
    const earlier = previous.current
    previous.current = received
    if (earlier === undefined) return
    const added = new Set(reactions.filter(item => !earlier.has(item.id)).map(item => item.emoji))
    if (added.size === 0 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    for (const emoji of added) {
      const chip = buttons.current.get(emoji)
      chip?.animate([
        { transform: 'translateY(2px) scale(.82)', opacity: .35 },
        { transform: 'translateY(-3px) scale(1.2)', opacity: 1, offset: .42 },
        { transform: 'translateY(0) scale(.97)', opacity: 1, offset: .72 },
        { transform: 'translateY(0) scale(1)', opacity: 1 },
      ], { duration: 560, easing: 'cubic-bezier(.2,.9,.25,1)' })
      chip?.querySelector<HTMLElement>('[data-reaction-emoji]')?.animate([
        { transform: 'rotate(-8deg) scale(.72)' },
        { transform: 'rotate(7deg) scale(1.42)', offset: .45 },
        { transform: 'rotate(0deg) scale(1)' },
      ], { duration: 620, easing: 'cubic-bezier(.2,.9,.25,1)' })
      for (const avatar of chip?.querySelectorAll<HTMLElement>('[data-reaction-reactor]') ?? []) {
        avatar.animate([
          { transform: 'scale(.65)', opacity: .45 },
          { transform: 'scale(1.22)', opacity: 1, offset: .5 },
          { transform: 'scale(1)', opacity: 1 },
        ], { duration: 520, easing: 'ease-out' })
      }
    }
  }, [reactionProjection, reactions])
  const participants = useProjection('teamChatParticipants') ?? {}
  const [open, setOpen] = useState(false)
  const [full, setFull] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const historical = originMissionId !== undefined && originMissionId !== sessionId
  const groups = new Map<string, typeof reactions>()
  for (const reaction of reactions) groups.set(reaction.emoji, [...(groups.get(reaction.emoji) ?? []), reaction])
  const toggle = async (emoji: string) => {
    if (pending) return
    setPending(true)
    setError('')
    try {
      await react(messageId, emoji, !reactions.some(item => item.reactorKind === 'user' && item.emoji === emoji))
      setOpen(false)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Error') }
    finally { setPending(false) }
  }
  return <div className={css.reactions} data-team-reactions={messageId} data-author-kind={authorKind}>
    {[...groups].map(([emoji, people]) => {
      const names = people.map(item => item.reactorKind === 'user' ? item.reactorName
        : participants[item.reactorId]?.name ?? teamIdentityOf(item.reactorName, item.reactorId).name)
      const userReacted = people.some(item => item.reactorKind === 'user')
      return <button key={emoji} ref={(element) => {
        if (element === null) buttons.current.delete(emoji)
        else buttons.current.set(emoji, element)
      }} className={css.reaction} disabled={pending || historical}
      title={names.join(', ')} aria-label={`${emoji} · ${names.join(', ')}`}
      aria-pressed={userReacted} data-user-reacted={userReacted ? 'true' : 'false'}
      onClick={() => { void toggle(emoji) }}>
        {people.filter(item => item.reactorKind !== 'user').slice(0, 3).map(item => <span
          className={css.reactionAvatar} key={item.reactorId} data-reaction-reactor={item.reactorKind}
        >
          <ModelActivityAvatar
            kind={KIRA_ROSTER.find(person => person.kind === participants[item.reactorId]?.avatar)?.kind
              ?? teamIdentityOf(participants[item.reactorId]?.name ?? item.reactorName, item.reactorId).kind}
            activity={undefined} running={false} pending={false} ready />
        </span>)}
        <span className={css.reactionEmoji} data-reaction-emoji aria-hidden="true">{emoji}</span>
        <span className={css.reactionCount} aria-hidden="true">{people.length}</span>
      </button>
    })}
    <button type="button" className={css.reactionAdd} aria-label={t('chat.addReaction')} disabled={historical}
      title={historical ? t('chat.historical') : t('chat.addReaction')} aria-expanded={open}
      data-add-reaction onClick={() => { setOpen(!open) }}><AddReactionIcon /></button>
    {authorKind === 'agent' && <button type="button" className={css.reaction} disabled={historical} onClick={() => { reply(messageId, authorId, authorName ?? '', replyPreview ?? '') }}>{t('chat.reply')}</button>}
    {open && <div className={css.emojiMenu}>
      {QUICK.map(emoji => <button type="button" key={emoji} disabled={pending || historical} onClick={() => { void toggle(emoji) }}>{emoji}</button>)}
      <button type="button" onClick={() => { setFull(!full) }}>+</button>
      {full && <Suspense fallback={<span>…</span>}><EmojiPicker onEmojiClick={(emoji) => { void toggle(emoji.emoji) }} lazyLoadEmojis width="100%" searchPlaceHolder={t('chat.searchEmoji')} /></Suspense>}
    </div>}
    {error !== '' && <span role="alert">{error}</span>}
  </div>
}

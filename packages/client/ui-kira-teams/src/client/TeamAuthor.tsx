/** Identity header for Kira's ordinary assistant output. */
import type { PropsLocale } from '@phoenix-ai/dsh-client-ui-slots'
import { NS } from './locales.ts'
import { ModelActivityAvatar } from './ModelActivityAvatar.tsx'
import css from './TeamChatMessage.module.css'
export function TeamAuthor({ t }: PropsLocale<typeof NS>) {
  return <div className={css.meta} data-team-author="kira">
    <span className={css.reactionAvatar}><ModelActivityAvatar kind="kira" activity={undefined} running={false} pending={false} ready /></span>
    <strong>Kira</strong><span>{t('skill.orchestration')}</span>
  </div>
}

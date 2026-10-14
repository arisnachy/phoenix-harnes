/** Identity header for Kira's ordinary assistant output. */
import type { PropsLocale } from '@phoenix-ai/dsh-client-ui-slots'
import { NS } from './locales.ts'
import { ModelActivityAvatar } from './ModelActivityAvatar.tsx'
import css from './TeamChatMessage.module.css'
export function TeamAuthor({ t, provenance }: PropsLocale<typeof NS> & {
  provenance?: { provider: string; model: string }
}) {
  return <div className={css.meta} data-team-author="kira">
    <span className={css.avatar}
      {...provenance === undefined ? {} : {
        'data-kira-model': provenance.model,
        'aria-label': `${provenance.provider} · ${provenance.model}`,
        title: `${provenance.provider} · ${provenance.model}`,
      }}>
      <ModelActivityAvatar kind="kira" activity={undefined} running={false} pending={false} ready
        model={provenance?.model} modelProvider={provenance?.provider} variant="card" />
    </span>
    <strong>Kira</strong><span>{t('skill.orchestration')}</span>
  </div>
}

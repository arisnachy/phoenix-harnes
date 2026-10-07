/** Identity header for the user-designed Phoenix Team lead. */
import type { SettingsScope } from '@phoenix-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale } from '@phoenix-ai/dsh-client-ui-slots'
import {
  activeTeamDesign,
  parseTeamDesignDocument,
  type TeamDesignSettingsEnvelope,
} from '@phoenix-ai/dsh-agent-team/design-types'
import { NS } from './locales.ts'
import { ModelActivityAvatar, type ModelAvatarKind } from './ModelActivityAvatar.tsx'
import css from './TeamChatMessage.module.css'

interface TeamAuthorInjected {
  hooks: { teamDesign: SettingsScope<TeamDesignSettingsEnvelope> }
}

export function TeamAuthor({ t, provenance, useTeamDesign }: PropsLocale<typeof NS> & InjectFace<TeamAuthorInjected> & {
  provenance?: { provider: string; model: string }
}) {
  const snapshot = useTeamDesign(value => value)
  const lead = activeTeamDesign(parseTeamDesignDocument(snapshot.value?.document)).lead
  return <div className={css.meta} data-team-author="kira">
    <span className={css.avatar}><ModelActivityAvatar kind={lead.avatar as ModelAvatarKind} activity={undefined} running={false} pending={false} ready /></span>
    {provenance === undefined ? null : <span className={css.modelBadge}
      data-kira-model={provenance.model} title={`${provenance.provider} · ${provenance.model}`}
      aria-label={`${provenance.provider} · ${provenance.model}`}>
      {provenance.provider !== 'openai-codex' ? 'ϟ' : /sol(?:$|[-_])/i.test(provenance.model) ? '☀'
        : /luna(?:$|[-_])/i.test(provenance.model) ? '☾'
          : /astra(?:$|[-_])/i.test(provenance.model) ? '★' : 'ϟ'}
    </span>}
    <strong>{lead.displayName}</strong><span>{lead.role || t('skill.orchestration')}</span>
  </div>
}

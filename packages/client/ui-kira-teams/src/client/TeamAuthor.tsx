/** Identity header for Kira's ordinary assistant output. */
import type { PropsLocale } from '@phoenix-ai/dsh-client-ui-slots'
import { NS } from './locales.ts'
import { ModelActivityAvatar, ModelEngineBadge, type KiraPresenceState } from './ModelActivityAvatar.tsx'
import css from './TeamChatMessage.module.css'
import { useLivingTeamNames, teamVisibleName } from './team-customization-react.ts'

const presenceKeys = {
  thinking: 'presence.thinking',
  working: 'presence.working',
  responding: 'presence.responding',
  interrupted: 'presence.interrupted',
  settled: 'presence.settled',
} as const

export function TeamAuthor({ t, provenance, presence = 'settled' }: PropsLocale<typeof NS> & {
  provenance?: { provider: string; model: string }
  presence?: KiraPresenceState
}) {
  const names = useLivingTeamNames()
  const name = teamVisibleName(names, 'kira', 'Kira')
  const live = presence === 'thinking' || presence === 'working' || presence === 'responding'
  const status = t(presenceKeys[presence])
  return <div className={css.meta} data-team-author="kira" data-kira-presence={presence}>
    <details className={css.kiraPresence}
      {...provenance === undefined ? {} : { 'data-kira-model': provenance.model }}>
      <summary aria-label={name + ' · ' + t('presence.profile')} title={name + ' · ' + status}
        onKeyDown={event => {
          if (event.key === 'Escape') {
            event.currentTarget.parentElement?.removeAttribute('open')
            event.currentTarget.focus()
          }
        }}>
        <ModelActivityAvatar kind="kira" activity={undefined} running={live} pending={false}
          ready={!live} presence={presence} showEngineBadge={false} />
      </summary>
      <div className={css.kiraProfile}>
        <div className={css.kiraProfileHead}>
          <div className={css.kiraProfileText}>
            <strong>{name}</strong>
            <span>{t('skill.orchestration')}</span>
            <span className={css.kiraProfileState}>{status}</span>
          </div>
        </div>
        <div className={css.kiraProfileModel}>
          <span>{t('presence.model')}</span>
          <span>{provenance === undefined ? t('presence.unknownModel') : provenance.model}</span>
          {provenance !== undefined && <span>{provenance.provider}</span>}
        </div>
      </div>
    </details>
    <strong title={t('skill.orchestration')}>{name}</strong>
    <ModelEngineBadge model={provenance?.model} provider={provenance?.provider} placement="header" />
    <span className={css.role}>{t('skill.orchestration')}</span>
    <span className={css.audience} data-team-audience="user">{t('chat.forYou')}</span>
  </div>
}

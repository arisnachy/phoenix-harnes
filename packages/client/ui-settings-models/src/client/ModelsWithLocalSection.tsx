import type { ReactNode } from 'react'
import type { InjectFace } from '@phoenix-ai/dsh-client-ui-slots'
import { ModelsSection } from './ModelsSection.tsx'
import type { ModelsSectionInjected } from './ModelsSection.tsx'
import { CodexResetsPanel } from './CodexResetsPanel.tsx'
import type { CodexResetClient } from './CodexResetsPanel.tsx'
import { PhoenixLocalPanel } from './PhoenixLocalPanel.tsx'
import type { PhoenixLocalModelClient } from './PhoenixLocalPanel.tsx'
import type { PhoenixLocalKey } from './phoenix-local-locales.ts'

/** Models-page injection extended with Host-owned local and Codex controls. */
export interface ModelsWithLocalSectionInjected extends ModelsSectionInjected {
  localModel: PhoenixLocalModelClient
  localT: (key: PhoenixLocalKey) => string
  codexReset: CodexResetClient
}

export type ModelsWithLocalSectionProps = Partial<InjectFace<ModelsWithLocalSectionInjected>>

/** Preserve the provider editor and append native Codex and Phoenix Local controls. */
export function ModelsWithLocalSection(props: ModelsWithLocalSectionProps): ReactNode {
  const { localModel, localT, t, codexReset } = props
  return (
    <>
      <ModelsSection {...props} />
      {t === undefined ? null : <CodexResetsPanel t={t} client={codexReset} />}
      {localModel === undefined || localT === undefined
        ? null
        : <PhoenixLocalPanel client={localModel} t={localT} />}
    </>
  )
}

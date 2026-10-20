import type { ReactNode } from 'react'
import type { InjectFace } from '@phoenix-ai/dsh-client-ui-slots'
import { ModelsSection } from './ModelsSection.tsx'
import type { ModelsSectionInjected } from './ModelsSection.tsx'
import { PhoenixLocalPanel } from './PhoenixLocalPanel.tsx'
import type { PhoenixLocalModelClient } from './PhoenixLocalPanel.tsx'
import type { PhoenixLocalKey } from './phoenix-local-locales.ts'
import { EclipseRoutingPanel } from './EclipseRoutingPanel.tsx'
import type { EclipseCatalogChoice } from './EclipseRoutingPanel.tsx'

/** Models-page injection extended with the Host-owned local-runtime façade. */
export interface ModelsWithLocalSectionInjected extends ModelsSectionInjected {
  localModel: PhoenixLocalModelClient
  localT: (key: PhoenixLocalKey) => string
  loadEclipseCatalog: () => Promise<readonly EclipseCatalogChoice[]>
}

export type ModelsWithLocalSectionProps = Partial<InjectFace<ModelsWithLocalSectionInjected>>

/** Keep the existing provider page intact and append Phoenix Local to that same Settings page. */
export function ModelsWithLocalSection(props: ModelsWithLocalSectionProps): ReactNode {
  const { localModel, localT, controller, api, t, loadEclipseCatalog } = props
  return (
    <>
      <ModelsSection {...props} />
      {controller !== undefined && api !== undefined && t !== undefined && loadEclipseCatalog !== undefined
        ? <EclipseRoutingPanel controller={controller} api={api} t={t} loadCatalog={loadEclipseCatalog} />
        : null}
      {localModel === undefined || localT === undefined
        ? null
        : <PhoenixLocalPanel client={localModel} t={localT} />}
    </>
  )
}

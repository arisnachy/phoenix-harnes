import { useEffect, useState } from 'react'
import { readTeamNames, subscribeTeamProfiles, type TeamDisplayNames, type LivingTeamKind } from './team-customization.ts'

/** Shared local projection only; immutable agent runtime keys remain canonical. */
export function useLivingTeamNames(): TeamDisplayNames {
  const [names, setNames] = useState<TeamDisplayNames>({})
  useEffect(() => {
    let active = true
    const reload = () => { void readTeamNames().then(value => { if (active) setNames(value) }).catch(() => {}) }
    reload()
    const release = subscribeTeamProfiles(reload)
    return () => { active = false; release() }
  }, [])
  return names
}
/** Only visual aliases. Runtime conversations keep the durable member id. */
export function teamVisibleName(names: TeamDisplayNames, kind: string, fallback: string): string {
  return names[kind as LivingTeamKind] ?? fallback
}

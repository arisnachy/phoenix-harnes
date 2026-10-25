/**
 * Read-only, locale-aware overview for shipped agent compositions.
 *
 * Source YAML is NEVER translated or rewritten: id, module path, expressions,
 * user prompts and plugin settings are executable configuration. The overview
 * explains every declared row in the active UI language, while the source tab
 * exposes the exact original bytes for technical inspection.
 */
import type { ReactNode } from 'react'
import type { AgentPresetSettingsKey } from './locales.ts'
import css from './AgentPresetSection.module.css'

type Item = { id: string; plugin: string; disabled: boolean }
type Group = { key: AgentPresetSettingsKey; items: Item[] }
type Translate = (key: AgentPresetSettingsKey) => string

const GROUPS: Readonly<Record<string, AgentPresetSettingsKey>> = {
  identity: 'viewerIdentity',
  shell: 'viewerShell',
  filesystem: 'viewerFilesystem',
  'background jobs': 'viewerJobs',
  skills: 'viewerSkills',
  goals: 'viewerGoals',
  'plan mode': 'viewerPlanning',
  compaction: 'viewerCompaction',
  'delegation and workflows': 'viewerTeam',
  'native image generation': 'viewerImages',
  'remaining model-facing rows': 'viewerTools',
  presentation: 'viewerPresentation',
  'self-modification': 'viewerAuthoring',
}

const GROUP_DETAILS: Readonly<Partial<Record<AgentPresetSettingsKey, AgentPresetSettingsKey>>> = {
  viewerIdentity: 'viewerIdentityDetail',
  viewerShell: 'viewerShellDetail',
  viewerFilesystem: 'viewerFilesystemDetail',
  viewerJobs: 'viewerJobsDetail',
  viewerSkills: 'viewerSkillsDetail',
  viewerGoals: 'viewerGoalsDetail',
  viewerPlanning: 'viewerPlanningDetail',
  viewerCompaction: 'viewerCompactionDetail',
  viewerTeam: 'viewerTeamDetail',
  viewerImages: 'viewerImagesDetail',
  viewerTools: 'viewerToolsDetail',
  viewerPresentation: 'viewerPresentationDetail',
  viewerAuthoring: 'viewerAuthoringDetail',
  viewerOther: 'viewerOtherDetail',
}

/** Parse plugin-row headers only; never evaluate YAML or its !!js expressions. */
export function compositionGroups(content: string): Group[] {
  const groups: Group[] = []
  let current: Group = { key: 'viewerOther', items: [] }
  const lines = content.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    const header = /^#\s*─{2,}\s*(.*?)\s*─{2,}\s*$/.exec(line)
    if (header !== null) {
      if (current.items.length > 0) groups.push(current)
      current = { key: GROUPS[header[1]?.trim().toLowerCase() ?? ''] ?? 'viewerOther', items: [] }
      continue
    }
    const match = /^\s*- id:\s*([a-z0-9-]+)\s*$/.exec(line)
    if (match === null) continue
    const id = match[1]
    if (id === undefined) continue
    const indent = line.search(/\S/)
    let plugin = ''
    let disabled = false
    // Only this row's immediate attributes; never inspect another sibling.
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j] ?? ''
      if (next.trim() === '' || next.trim().startsWith('#')) continue
      if (next.search(/\S/) <= indent) break
      const name = /^\s*name:\s*['"]?([^'"\r\n]+)['"]?\s*$/.exec(next)
      if (name !== null && plugin === '') plugin = name[1]?.trim() ?? ''
      if (/^\s*disabled:\s*(?:true|!!js\s+)/.test(next)) disabled = true
      if (/^\s*config:\s*/.test(next) || /^\s*group:\s*/.test(next)) break
    }
    if (plugin !== '') current.items.push({ id, plugin, disabled })
  }
  if (current.items.length > 0) groups.push(current)
  return groups
}

/** Read-only explanatory view in the locale selected in Phoenix settings. */
export function CompositionOverview({ content, t }: { content: string; t: Translate }): ReactNode {
  const groups = compositionGroups(content)
  return (
    <div className={css.overview} data-preset-overview="">
      <p className={css.overviewIntro}>{t('viewerIntro')}</p>
      {groups.map((group, index) => (
        <section className={css.overviewSection} key={String(index) + group.key}>
          <h4>{t(group.key)} <span>({group.items.length})</span></h4>
          <p className={css.overviewIntro}>{t(GROUP_DETAILS[group.key] ?? 'viewerOtherDetail')}</p>
          <ul className={css.overviewList}>
            {group.items.map(item => (
              <li key={item.id}>
                <span>{item.id}</span>
                <code title={item.plugin}>{item.plugin}</code>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

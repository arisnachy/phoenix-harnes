/**
 * Small, dependency-free robots.txt parser. Exact PHOENIX agent directives take
 * precedence over wildcard groups; longest matching path wins, Allow on ties.
 */
/** One site-supplied robots allow or deny path rule. */
export interface RobotsRule { readonly path: string; readonly allow: boolean }
/** The resolved rules and per-agent crawl delay for a public origin. */
export interface RobotsPolicy {
  readonly rules: readonly RobotsRule[]
  readonly crawlDelayMs: number
}
type Group = { agents: string[]; rules: RobotsRule[]; delay?: number }

/**
 * Parse a site's robot groups without network access.
 * @param text - Bounded robots.txt contents.
 * @param agent - PHOENIX public bot token to match.
 * @returns Matching rules and crawl delay.
 */
export function parseRobots(text: string, agent = 'PHOENIX-ResearchBot'): RobotsPolicy {
  const groups: Group[] = []
  let current: Group = { agents: [], rules: [] }
  let sawRules = false
  const push = () => {
    if (current.agents.length > 0) groups.push(current)
    current = { agents: [], rules: [] }
    sawRules = false
  }
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.split('#', 1)[0]?.trim() ?? ''
    const matched = /^([a-z-]+)\s*:\s*(.*)$/iu.exec(line)
    if (!matched) continue
    const directive = matched[1]?.toLowerCase()
    const value = matched[2]?.trim() ?? ''
    if (directive === 'user-agent') {
      if (sawRules) push()
      if (value) current.agents.push(value.toLowerCase())
      continue
    }
    if (current.agents.length === 0) continue
    if (directive === 'allow' || directive === 'disallow') {
      sawRules = true
      // An empty Disallow is not a deny-all.
      if (value) current.rules.push({ path: value, allow: directive === 'allow' })
    }
    if (directive === 'crawl-delay') {
      sawRules = true
      const seconds = Number(value)
      if (Number.isFinite(seconds) && seconds >= 0) current.delay = Math.min(seconds, 300)
    }
  }
  push()
  const token = agent.toLowerCase().split(/[\s/]/u)[0] ?? ''
  const matched = groups.flatMap(group => group.agents
    .filter(name => name === '*' || token.includes(name))
    .map(name => ({ group, specificity: name === '*' ? 0 : name.length })))
  const best = Math.max(-1, ...matched.map(item => item.specificity))
  const selected = matched.filter(item => item.specificity === best).map(item => item.group)
  return {
    rules: selected.flatMap(group => group.rules),
    crawlDelayMs: Math.ceil(Math.max(0, ...selected.map(group => (group.delay ?? 0) * 1000))),
  }
}

/**
 * Decide whether a URL is permitted by the resolved robots rules.
 * @param url - Requested public URL.
 * @param policy - Parsed and selected origin policy.
 * @returns True unless a longest-matching Disallow rule wins.
 */
export function robotsAllows(url: URL, policy: RobotsPolicy): boolean {
  const path = url.pathname + url.search
  let bestLength = -1
  let allowed = true
  for (const rule of policy.rules) {
    const terminal = rule.path.endsWith('$')
    const raw = terminal ? rule.path.slice(0, -1) : rule.path
    const pattern = raw.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('.*')
    const re = new RegExp(`^${pattern}${terminal ? '$' : ''}`, 'u')
    if (!re.test(path)) continue
    const length = raw.replace(/\*/gu, '').length
    if (length > bestLength || (length === bestLength && rule.allow)) {
      bestLength = length
      allowed = rule.allow
    }
  }
  return allowed
}

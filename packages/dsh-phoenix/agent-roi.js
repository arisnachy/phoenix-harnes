const DEFAULT_TOOL_NAMES = ['subagent']
const TRIVIAL = /\b(find|locate|grep|search for|read|list|show|where is|which file|what file)\b/i
const COMPLEX = /\b(audit|architecture|security|independent|parallel|compare|multiple|cross[- ]?cutting|investigate|research|benchmark|review)\b/i

function flattenStrings(value, out = []) {
  if (typeof value === 'string') out.push(value)
  else if (Array.isArray(value)) for (const item of value) flattenStrings(item, out)
  else if (value && typeof value === 'object') for (const item of Object.values(value)) flattenStrings(item, out)
  return out
}

export function phoenixAgentRoiDecision(argumentsValue, config = {}) {
  const text = flattenStrings(argumentsValue).join(' ').trim()
  const trivialMaxChars = Math.max(40, Number(config.trivialMaxChars ?? 240))
  if (!text) return { allow: true, reason: 'no prompt text to classify' }
  if (COMPLEX.test(text)) return { allow: true, reason: 'complex or parallel work justifies delegation' }
  if (text.length <= trivialMaxChars && TRIVIAL.test(text)) {
    return {
      allow: false,
      reason: 'PHOENIX Agent ROI Gate: use a direct deterministic/tool lookup before spawning a subagent for a trivial discovery task.',
    }
  }
  return { allow: true, reason: 'delegation not classified as trivial' }
}

export const name = 'phoenix-agent-roi'
export const inject = ['tools']

export function apply(ctx, config = {}) {
  const names = new Set((config.subagentToolNames ?? DEFAULT_TOOL_NAMES).map(String))
  ctx.tools.guard((execution) => {
    if (!names.has(execution.name)) return undefined
    const decision = phoenixAgentRoiDecision(execution.arguments, config)
    return decision.allow ? undefined : decision.reason
  })
}

const ladder = new Map()
const failoverByAgent = new WeakMap()

const ROLE_WEIGHTS = {
  coding: { coding: 0.55, debugging: 0.2, reasoning: 0.15, reliability: 0.1 },
  debugging: { debugging: 0.5, coding: 0.2, reasoning: 0.2, reliability: 0.1 },
  research: { research: 0.5, reasoning: 0.25, toolUse: 0.15, reliability: 0.1 },
  security: { security: 0.45, critique: 0.2, reasoning: 0.2, reliability: 0.15 },
  judging: { judging: 0.4, critique: 0.3, reasoning: 0.15, reliability: 0.15 },
  orchestration: { orchestration: 0.45, planning: 0.25, reasoning: 0.15, reliability: 0.15 },
  routine: { efficiency: 0.4, toolUse: 0.2, reliability: 0.2, reasoning: 0.2 },
}

const FAILOVER_CODES = new Set([
  'RATE_LIMIT', 'SERVER', 'TRANSPORT', 'TIMEOUT', 'QUOTA_EXCEEDED', 'EMPTY_RESPONSE', 'OVERLOADED',
])

function key(provider, model) { return `${provider}\u0000${model}` }
function clamp(n) { return Math.max(0, Math.min(100, Number(n) || 0)) }

function normalize(entry, discovered = false) {
  const scores = {}
  for (const dimension of [
    'planning', 'orchestration', 'reasoning', 'coding', 'debugging', 'research',
    'toolUse', 'critique', 'judging', 'security', 'reliability', 'efficiency',
  ]) scores[dimension] = clamp(entry.scores?.[dimension])
  return {
    provider: String(entry.provider),
    model: String(entry.model),
    status: entry.status === 'qualified' ? 'qualified' : 'provisional',
    samples: Math.max(0, Math.floor(Number(entry.samples) || 0)),
    scores,
    discovered,
    failures: Math.max(0, Math.floor(Number(entry.failures) || 0)),
  }
}

export function getPhoenixModelLadderSnapshot() {
  return [...ladder.values()].map(item => ({ ...item, scores: { ...item.scores } }))
}

function lastUserText(agent) {
  try {
    const messages = agent.session.deriveMessages()
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i]
      if (message?.role !== 'user') continue
      return (message.content ?? []).map(block => block?.type === 'text' ? block.text : '').join(' ')
    }
  } catch {}
  return ''
}

export function classifyPhoenixRole(text) {
  const value = String(text).toLowerCase()
  if (/security|vulnerab|exploit|threat|auth|credential|injection/.test(value)) return 'security'
  if (/debug|bug|error|failing|stack trace|exception|fix/.test(value)) return 'debugging'
  if (/research|investig|search|compare|evidence|source/.test(value)) return 'research'
  if (/judge|review|critic|verify|validate|audit/.test(value)) return 'judging'
  if (/architect|orchestrat|plan|decompose|strategy|roadmap|coordinate/.test(value)) return 'orchestration'
  if (/code|implement|typescript|python|javascript|rust|function|class|refactor/.test(value)) return 'coding'
  return 'routine'
}

function roleScore(entry, role) {
  const weights = ROLE_WEIGHTS[role] ?? ROLE_WEIGHTS.routine
  let score = 0
  for (const [dimension, weight] of Object.entries(weights)) score += entry.scores[dimension] * weight
  const confidence = Math.min(1, entry.samples / 20)
  const failurePenalty = Math.min(30, entry.failures * 3)
  return score * (0.7 + confidence * 0.3) - failurePenalty
}

function ranked(role, excludedProviders = new Set()) {
  return [...ladder.values()]
    .filter(item => item.status === 'qualified' && item.samples >= 3 && !excludedProviders.has(item.provider))
    .map(item => ({ item, score: roleScore(item, role) }))
    .sort((a, b) => b.score - a.score || a.item.provider.localeCompare(b.item.provider) || a.item.model.localeCompare(b.item.model))
}

async function refresh(ctx) {
  const providers = ctx.llm.listProviders().map(item => item.id ?? item.provider ?? item.name).filter(Boolean)
  await Promise.all(providers.map(async provider => {
    let models = []
    try { models = await ctx.llm.listModels(provider) } catch { return }
    for (const modelInfo of models) {
      const model = modelInfo?.id
      if (!model) continue
      const id = key(provider, model)
      if (!ladder.has(id)) ladder.set(id, normalize({ provider, model, status: 'provisional', scores: {} }, true))
    }
  }))
}

export const name = 'phoenix-model-router'
export const inject = ['llm']

export function apply(ctx, config = {}) {
  ladder.clear()
  for (const entry of config.rankings ?? []) {
    if (!entry?.provider || !entry?.model) continue
    ladder.set(key(entry.provider, entry.model), normalize(entry, false))
  }

  void refresh(ctx)
  ctx.on('llm/adapters-updated', () => { void refresh(ctx) })

  ctx.on('agent/request', async ({ agent }, next) => {
    const base = await next()
    const role = classifyPhoenixRole(lastUserText(agent))
    const failover = failoverByAgent.get(agent)
    const excluded = failover?.excludedProviders ?? new Set()
    const winner = ranked(role, excluded)[0]?.item
    if (!winner) return base
    return { ...base, provider: winner.provider, model: winner.model }
  })

  ctx.on('agent/request-error', async (payload, next) => {
    for (const item of ladder.values()) {
      if (item.provider === payload.provider && item.status === 'qualified') item.failures += 1
    }
    if (!FAILOVER_CODES.has(String(payload.failure?.code ?? ''))) return next()
    const role = classifyPhoenixRole(lastUserText(payload.agent))
    const current = failoverByAgent.get(payload.agent) ?? { excludedProviders: new Set(), failovers: 0 }
    current.excludedProviders.add(payload.provider)
    current.failovers += 1
    failoverByAgent.set(payload.agent, current)
    const alternative = ranked(role, current.excludedProviders)[0]?.item
    if (!alternative) return next()
    return { kind: 'retry' }
  })

  ctx.on('agent/status', ({ agent, status }) => {
    if (status === 'idle') failoverByAgent.delete(agent)
  })
}

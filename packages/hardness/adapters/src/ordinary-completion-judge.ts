/**
 * Independent completion judge bridge for ordinary mutation tasks.
 *
 * Successful substantive mutations must first have deterministic verification.
 * The bridge then performs a bounded read-only semantic review before the turn
 * settles. A needs_changes verdict steers the original worker; the judge never
 * edits files or executes commands.
 */
import type { Context } from '@phoenix-ai/cordis'
import type { Agent } from '@phoenix-ai/dsh-agent'
import { createUserMessage } from '@phoenix-ai/dsh-llm'
import type { UserMessage } from '@phoenix-ai/dsh-session'
import type {
  ObjectJsonSchema,
  PostToolDecision,
  ToolExecution,
  ToolExecutionResult,
  ToolRestriction,
} from '@phoenix-ai/dsh-tools'
import { resolveStructuredProvider, type SubagentRuntime } from '@phoenix-ai/dsh-subagent'
import { isGameDevelopmentNeed, qualityRequirementsForNeed } from './quality-contract.ts'

const OUTPUT_SCHEMA: ObjectJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    verdict: { type: 'string', enum: ['pass', 'needs_changes', 'blocked'] },
    summary: { type: 'string' },
    evidence: { type: 'array', items: { type: 'string' } },
    known_limitations: { type: 'array', items: { type: 'string' } },
    risk_coverage: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ambiguity: { type: 'boolean' },
        limitations: { type: 'boolean' },
        report_integrity: { type: 'boolean' },
      },
      required: ['ambiguity', 'limitations', 'report_integrity'],
    },
    required_changes: { type: 'array', items: { type: 'string' } },
  },
  required: ['verdict', 'summary', 'evidence', 'known_limitations', 'risk_coverage', 'required_changes'],
}

const READ_ONLY_TOOLS = [
  'read',
  'read_image',
  'glob',
  'grep',
  'session_search',
  'session_event_search',
  'web_search',
  'web_fetch',
] as const

const MUTATION = /^(?:write|edit|str_replace_editor|apply_patch|create_file|update_file|delete_file|move_file|rename_file|upload(?:_.*)?|deploy(?:_.*)?|publish(?:_.*)?)$/
const VERIFY = /^(?:verify(?:_.*)?|check(?:_.*)?|test(?:_.*)?|lint(?:_.*)?|typecheck(?:_.*)?|build(?:_.*)?|smoke(?:_.*)?)$/
const SHELL = /^(?:bash|pwsh|run_code)$/
const VISUAL_VERIFY = /^(?:read_image|read_render|screenshot|capture(?:_.*)?|browser_(?:snapshot|inspect))$/
const PLAY_VERIFY = /^(?:gameplay(?:_.*)?|playtest(?:_.*)?)$/
const GAME_EDITOR_NAMESPACE = /(?:^|__|[.:/])(?:godot|unity|unreal|blender|aseprite|tiled)(?:__|[.:/])/i
const GAMEPLAY_NAMESPACE = /(?:^|__|[.:/])gameplay(?:__|[.:/])/i
const GAME_EDITOR_READ_ONLY = /(?:^|_)(?:get|list|read|inspect|query|search|find|status|capture|screenshot|snapshot|render|viewport|test|verify|build)(?:_|$)/i
const GAME_EDITOR_VISUAL_ACTION = /(?:^|_)(?:capture|screenshot|snapshot|render|viewport)(?:_|$)/i
const GAME_EDITOR_PLAY_ACTION = /(?:^|_)(?:play|run|start|launch|pie)(?:_|$)/i
const GAMEPLAY_VISUAL_ACTION = /(?:^|_)(?:capture|screenshot|snapshot|frame|inspect|render)(?:_|$)/i
const GAME_NEED = /\b(?:game|games|gaming|juego|juegos|videogame|videojuego|godot|unity|unreal|blender|sprite|tileset|npc|enemy|character|pixel\s*art|2d|3d|retro|nes|snes|rpg|platformer|metroidvania|gameplay)\b/i
const DIRECT_ASSET_MUTATION = /^(?:image_generation|audio_generation|generate_image|generate_audio)$/
const SHELL_VERIFY = /\b(?:vitest|pytest|unittest|jest|mocha|tsc|oxlint|eslint|ruff|mypy|cargo\s+test|go\s+test|dotnet\s+test|pnpm\s+(?:run\s+)?(?:test|check|lint|typecheck|build|verify)|npm\s+(?:run\s+)?(?:test|check|lint|build|verify)|yarn\s+(?:test|check|lint|build)|python\s+-m\s+pytest|benchmark|tracemalloc)\b/i
// oxlint-disable-next-line @stylistic/max-len -- Keep the game-runtime matcher auditable as one regex literal.
const SHELL_PLAY_VERIFY = /\b(?:retroarch|mesen|playtest|gameplay|godot(?:\.exe)?\b.*--path|unity(?:\.exe)?\b.*playmode|unreal(?:editor)?(?:\.exe)?\b.*(?:-game|pie))\b/i
const SHELL_MUTATE = /(?:^|[\s;&|])(?:rm|mv|cp|mkdir|touch|git\s+(?:add|commit|merge|rebase|cherry-pick|reset|checkout|switch)|Set-Content|Add-Content|Out-File|Remove-Item|Move-Item|Copy-Item|New-Item|Rename-Item)\b|(?:>>?|\b(?:sed\s+-i|tee)\b)/i
// Game-native source, scene, model, raster and audio files must reopen completion review just like ordinary code files.
const SUBSTANTIVE = /\.(?:ts|tsx|js|jsx|mjs|cjs|py|rs|go|java|kt|c|cc|cpp|h|hpp|cs|php|rb|swift|html?|css|scss|sass|less|vue|svelte|ya?ml|toml|json|gd|tscn|tres|godot|gdshader|shader|prefab|unity|anim|controller|mat|uasset|umap|blend1?|glb|gltf|fbx|obj|ase|aseprite|tmx|png|webp|jpe?g|gif|wav|ogg|mp3|flac|ttf|otf|woff2?)\b/i

/** Structured outcome returned by one ordinary-task independent completion review. */
export interface OrdinaryCompletionJudgeDecision {
  readonly verdict: 'pass' | 'needs_changes' | 'blocked'
  readonly summary: string
  readonly evidence: readonly string[]
  readonly knownLimitations: readonly string[]
  readonly riskCoverage: {
    readonly ambiguity: boolean
    readonly limitations: boolean
    readonly reportIntegrity: boolean
  }
  readonly requiredChanges: readonly string[]
}

type JudgeRuntime = Pick<SubagentRuntime, 'getProvider' | 'start'> & Partial<Pick<SubagentRuntime, 'list'>>

interface BridgeState {
  generation: number
  verifiedGeneration: number
  technicalVerifiedGeneration: number
  visualVerifiedGeneration: number
  playVerifiedGeneration: number
  judgedGeneration: number
  judgePasses: number
  request: string
  mutations: string[]
  verifications: string[]
}

function operationName(toolName: string): string {
  const normalized = toolName.toLowerCase().replaceAll('-', '_')
  return normalized.split(/(?:__|[.:/])/).at(-1) || normalized
}

function argumentText(value: unknown): string {
  try { return JSON.stringify(value) ?? 'null' } catch { return String(value) }
}

/**
 * Classify whether a tool invocation represents a substantive mutation that reopens completion review.
 * @param name - fully qualified tool name.
 * @param args - tool arguments used to detect substantive targets or shell mutations.
 * @returns true when the invocation changes a substantive artifact or game asset.
 * @internal
 */
export function isSubstantiveMutation(name: string, args: unknown): boolean {
  const normalizedName = name.toLowerCase().replaceAll('-', '_')
  const op = operationName(name)
  const text = argumentText(args)
  if (DIRECT_ASSET_MUTATION.test(op)) return true
  if (op === 'hardness_run' && GAME_NEED.test(text)) return true
  if (GAME_EDITOR_NAMESPACE.test(normalizedName) && !GAME_EDITOR_READ_ONLY.test(op)) return true
  if (MUTATION.test(op)) return SUBSTANTIVE.test(text)
  return SHELL.test(op) && SHELL_MUTATE.test(text) && SUBSTANTIVE.test(text)
}

type VerificationKind = 'technical' | 'visual' | 'play'

/**
 * Classify which deterministic verification gates a tool invocation satisfies.
 * @param name - fully qualified tool name.
 * @param args - tool arguments used to recognize shell, visual, and gameplay checks.
 * @returns verification kinds proven by the invocation.
 * @internal
 */
export function verificationKinds(name: string, args: unknown): readonly VerificationKind[] {
  const normalizedName = name.toLowerCase().replaceAll('-', '_')
  const op = operationName(name)
  const argsText = argumentText(args)
  const gameEditorTool = GAME_EDITOR_NAMESPACE.test(normalizedName)
  const gameplayTool = GAMEPLAY_NAMESPACE.test(normalizedName)
  const kinds = new Set<VerificationKind>()
  if (VERIFY.test(op) || (SHELL.test(op) && SHELL_VERIFY.test(argsText))) kinds.add('technical')
  if (
    VISUAL_VERIFY.test(op)
    || (gameEditorTool && GAME_EDITOR_VISUAL_ACTION.test(op))
    || (gameplayTool && GAMEPLAY_VISUAL_ACTION.test(op))
    || (PLAY_VERIFY.test(op) && /(?:capture|screenshot|snapshot|frame|inspect)/u.test(op))
  ) kinds.add('visual')
  if (
    PLAY_VERIFY.test(op)
    || (gameEditorTool && GAME_EDITOR_PLAY_ACTION.test(op))
    || gameplayTool
    || (SHELL.test(op) && SHELL_PLAY_VERIFY.test(argsText))
  ) kinds.add('play')
  return [...kinds]
}

function requestText(message: UserMessage): string {
  return message.content
    .filter((block): block is Extract<UserMessage['content'][number], { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join(' ')
    .slice(0, 12_000)
}

function validText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 4_000
}

function validList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 12 && value.every(validText)
}

function uniqueList(items: readonly string[]): string[] | undefined {
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of items) {
    const key = item.replace(/\s+/gu, ' ').trim().toLocaleLowerCase()
    if (seen.has(key)) return undefined
    seen.add(key)
    result.push(item)
  }
  return result
}

function parseDecision(value: unknown): OrdinaryCompletionJudgeDecision | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const risk = record.risk_coverage
  if (!validText(record.verdict) || !['pass', 'needs_changes', 'blocked'].includes(record.verdict)
    || !validText(record.summary) || !validList(record.evidence) || !validList(record.known_limitations)
    || !validList(record.required_changes)
    || risk === null || typeof risk !== 'object' || Array.isArray(risk)) return undefined
  const riskRecord = risk as Record<string, unknown>
  if (typeof riskRecord.ambiguity !== 'boolean' || typeof riskRecord.limitations !== 'boolean'
    || typeof riskRecord.report_integrity !== 'boolean') return undefined
  const evidence = uniqueList(record.evidence)
  const knownLimitations = uniqueList(record.known_limitations)
  const requiredChanges = uniqueList(record.required_changes)
  if (evidence === undefined || knownLimitations === undefined || requiredChanges === undefined) return undefined
  if (record.verdict === 'pass' && (evidence.length === 0
    || !riskRecord.ambiguity || !riskRecord.limitations || !riskRecord.report_integrity)) return undefined
  if (record.verdict === 'needs_changes' && requiredChanges.length === 0) return undefined
  return {
    verdict: record.verdict as OrdinaryCompletionJudgeDecision['verdict'],
    summary: record.summary,
    evidence,
    knownLimitations,
    riskCoverage: {
      ambiguity: riskRecord.ambiguity,
      limitations: riskRecord.limitations,
      reportIntegrity: riskRecord.report_integrity,
    },
    requiredChanges,
  }
}

/**
 * Run one fresh read-only semantic completion review.
 * @param input - judge runtime, provider, parent task, evidence summary, and cancellation signal.
 * @returns validated independent verdict; malformed or unavailable review fails closed as blocked.
 */
export async function reviewOrdinaryCompletion(input: {
  readonly subagents: JudgeRuntime
  readonly provider: string
  readonly parent: Agent
  readonly request: string
  readonly mutations: readonly string[]
  readonly verifications: readonly string[]
  readonly signal: AbortSignal
}): Promise<OrdinaryCompletionJudgeDecision> {
  const resolved = resolveStructuredProvider({
    getProvider: name => input.subagents.getProvider(name),
    list: () => input.subagents.list?.() ?? [],
  }, input.provider)
  if (resolved === undefined) {
    return {
      verdict: 'blocked', summary: 'Independent completion judge is unavailable.', evidence: [],
      knownLimitations: [], riskCoverage: { ambiguity: false, limitations: false, reportIntegrity: false }, requiredChanges: [],
    }
  }

  const toolFilter: ToolRestriction = { allow: [...READ_ONLY_TOOLS] }
  const taskQuality = qualityRequirementsForNeed({ description: input.request })
  const gameReview = isGameDevelopmentNeed({ description: input.request })
    ? 'This is game-development work. Require three independent evidence gates from the current mutation generation: technical build/test/check evidence, visual capture inspected with read_image/screenshot, and executed gameplay/playtest evidence. A build cannot satisfy the visual or play gate; a screenshot cannot satisfy the play gate; a gameplay tool call cannot replace close visual inspection. Require actual evidence for graphics/art direction, character quality, environment quality, animation/VFX, UI, music/ambience/SFX and mix, gameplay feel, camera/input/collision feedback, and performance from an executed build or emulator. When improving an existing game, require a baseline capture of the current build and a comparable after capture; visible regressions or no material improvement fail when the request is to make it better. Compare with strong current category references when web tools are available. Inspect the latest gameplay frame with read_image when available and explicitly judge the player plus representative enemy and NPC/interactive actors at normal gameplay scale and close enough to see sprite/model detail. Inspect session evidence for use of production asset tools such as image_generation backend=auto, Aseprite/Tiled, Blender, engine-native asset pipelines, or an equivalent real raster/3D/audio workflow when available; DOM/CSS/SVG/canvas primitives are not a substitute for final character or environment art. Do not pass any final actor rendered as a rectangle, box, circle, capsule, emoji, text glyph, single flat block, default mannequin, primitive mesh, or collision/debug shape unless the user explicitly requested an abstract/minimalist art direction and the evidence shows that choice is intentional and polished. For 2D/pixel art require role-readable silhouettes, coherent palette/pixel density/scale, clean transparency, and animation-state coverage appropriate to the role: locomotion in every relevant direction plus attack/telegraph, hurt, death, or interaction states where applicable. Do not pass placeholders, default/template assets, silent or temporary audio, empty environments, generic characters, screenshot-only evidence, compile-only evidence, or technically functional but visibly unpolished gameplay. When the request includes an intro, opening, title sequence, menu, or cutscene, require evidence of a production-quality boot/title/menu/intro flow and a real transition into gameplay. Treat sparse repeated-prop maps as incomplete: require scene density, terrain transitions, landmarks, structures where appropriate, prop and vegetation variety, and environmental storytelling. '
    : ''
  let run: Awaited<ReturnType<JudgeRuntime['start']>> | undefined
  try {
    run = await input.subagents.start(resolved.name, {
      label: 'ordinary-completion-judge',
      parent: input.parent,
      signal: input.signal,
      outputSchema: OUTPUT_SCHEMA,
      toolFilter,
      prompt: [{
        type: 'text',
        text: '<phoenix_ordinary_completion_judge>\n'
          + 'Original request: ' + JSON.stringify(input.request) + '\n'
          + 'Observed mutation tools: ' + JSON.stringify(input.mutations) + '\n'
          + 'Observed verification tools: ' + JSON.stringify(input.verifications) + '\n'
          + 'Task quality contract: ' + JSON.stringify(taskQuality) + '\n\n'
          + 'Act as a fresh, read-only completion judge. Inspect the actual changed artifact and durable session evidence. '
          + gameReview
          + 'First derive an immutable literal checklist from the original request. Every explicitly named library, API, CLI flag, function name, format, wording, limit, and required behavior is mandatory and may not disappear during review. '
          + 'Map every explicit mandatory requirement to concrete evidence; passing tests are evidence, not blanket proof. Audit material assertions for expected-value provenance: '
          + 'an expected result must come from the specification, a reference implementation/standard, a mathematical or metamorphic invariant, or an independent fixture. '
          + 'If a test copied or derived its expected value from the implementation under test, treat it as circular and insufficient even when green. '
          + 'For parsers, regexes, iterators, scanners, strings, and loop-driven input processing, explicitly inspect applicable empty/single/boundary cases, Unicode outside the BMP, '
          + 'zero-length or zero-progress iterations, first/last iteration off-by-one behavior, malformed inputs, and exact error positions. When a trustworthy oracle exists, prefer differential generated/fuzz cases; otherwise require property/metamorphic checks. '
          + 'For public errors/exceptions verify the observable type and every required message field, identifier, collection, or diagnostic detail. '
          + 'When scale, large cardinality, performance, latency, depth, concurrency, or memory matters, require evidence that checks growth/resource behavior and inspect for avoidable superlinear time or space. '
          + 'Apply a universal risk pass before deciding completion: actively search for ambiguous representations or implicit conventions; vary realistic input, environment, and state when applicable; and generate plausible failure classes that were not suggested by the worker. '
          + 'Do not infer "no known limitations" from green tests. An empty known_limitations list requires concrete evidence that plausible limitation classes were considered, tested, or explicitly bounded. '
          + 'Cross-check the closing facts, counts, statuses, and limitation statements so the final report has one canonical result with no duplicate or contradictory claims. Set every risk_coverage flag only after performing that check. '
          + 'Check the real user/production entrypoint and relevant boundary/failure cases. Do not edit files or run commands. '
          + 'Return pass only with concrete evidence for all material requirements and all three risk_coverage checks true. Return needs_changes with a precise repair list for fixable gaps; blocked only for an external evaluation blocker.\n'
          + '</phoenix_ordinary_completion_judge>',
      }],
    })
    const result = await run.result
    if (result.stopReason !== 'completed') {
      return {
        verdict: 'blocked', summary: 'Independent completion judge did not complete.', evidence: [],
        knownLimitations: [], riskCoverage: { ambiguity: false, limitations: false, reportIntegrity: false }, requiredChanges: [],
      }
    }
    return parseDecision(result.structured)
      ?? {
        verdict: 'blocked', summary: 'Independent completion judge returned invalid evidence.', evidence: [],
        knownLimitations: [], riskCoverage: { ambiguity: false, limitations: false, reportIntegrity: false }, requiredChanges: [],
      }
  } catch {
    return {
      verdict: 'blocked', summary: 'Independent completion judge failed.', evidence: [],
      knownLimitations: [], riskCoverage: { ambiguity: false, limitations: false, reportIntegrity: false }, requiredChanges: [],
    }
  } finally {
    if (run !== undefined) await run.dispose()
  }
}

function judgeNotice(decision: OrdinaryCompletionJudgeDecision): UserMessage {
  const repairs = decision.requiredChanges.length > 0
    ? ' Required changes: ' + decision.requiredChanges.map((item, index) => `${index + 1}. ${item}`).join(' ')
    : ''
  return createUserMessage({
    content: [{
      type: 'text',
      text: decision.verdict === 'needs_changes'
        ? 'Independent completion review found fixable gaps. Do not present the task as complete yet.' + repairs
        : 'Independent completion review could not verify completion: ' + decision.summary
          + ' Continue with the cheapest deterministic inspection/verification that resolves the blocker; do not claim completion without evidence.',
    }],
    source: { kind: 'plugin', plugin: 'ordinary-completion-judge', form: 'notice', summary: 'independent completion review' },
  })
}

/**
 * Install bounded independent review for verified substantive ordinary mutations.
 * @param ctx - scoped Cordis context whose agent/tool events are observed.
 * @param input - structured subagent runtime, provider route, and review-pass bound.
 * @returns disposer that removes every bridge listener.
 */
export function installOrdinaryCompletionJudgeBridge(
  ctx: Context,
  input: { readonly subagents: JudgeRuntime; readonly provider: string; readonly maxPasses?: number },
): () => void {
  const maxPasses = input.maxPasses ?? 2
  const states = new WeakMap<Agent, BridgeState>()
  const disposers: (() => void)[] = []

  disposers.push(ctx.on('agent/inbox/claimed', ({ agent, message }) => {
    if (message.source.kind !== 'user') return
    states.set(agent, {
      generation: 0,
      verifiedGeneration: 0,
      technicalVerifiedGeneration: 0,
      visualVerifiedGeneration: 0,
      playVerifiedGeneration: 0,
      judgedGeneration: 0,
      judgePasses: 0,
      request: requestText(message),
      mutations: [],
      verifications: [],
    })
  }))

  disposers.push(ctx.on('tools/post-execute', async (
    exec: ToolExecution,
    result: Readonly<ToolExecutionResult>,
    next,
  ): Promise<PostToolDecision> => {
    const downstream = await next()
    if (exec.agent === undefined || result.isError || downstream.kind === 'block') return downstream
    const state = states.get(exec.agent)
    if (state === undefined) return downstream

    if (isSubstantiveMutation(exec.name, exec.arguments)) {
      state.generation += 1
      state.mutations.push(operationName(exec.name))
      state.mutations = state.mutations.slice(-12)
    } else if (state.generation > 0) {
      const kinds = verificationKinds(exec.name, exec.arguments)
      if (kinds.length > 0) {
        state.verifiedGeneration = state.generation
        if (kinds.includes('technical')) state.technicalVerifiedGeneration = state.generation
        if (kinds.includes('visual')) state.visualVerifiedGeneration = state.generation
        if (kinds.includes('play')) state.playVerifiedGeneration = state.generation
        // A judge may ask only for missing evidence. New deterministic evidence
        // must therefore reopen this unchanged generation for a fresh review.
        if (state.judgedGeneration === state.generation) state.judgedGeneration = 0
        state.verifications.push(kinds.join('+') + ':' + operationName(exec.name) + ':' + argumentText(exec.arguments).slice(0, 260))
        state.verifications = state.verifications.slice(-12)
      }
    }
    return downstream
  }))

  disposers.push(ctx.on('agent/turn-stopping', async ({ agent, signal }) => {
    const state = states.get(agent)
    if (state === undefined || state.generation === 0) return
    if (isGameDevelopmentNeed({ description: state.request })) {
      const missing: string[] = []
      if (state.technicalVerifiedGeneration !== state.generation) missing.push('technical build/test/check evidence')
      if (state.visualVerifiedGeneration !== state.generation) missing.push('visual capture plus read_image/screenshot inspection')
      if (state.playVerifiedGeneration !== state.generation) missing.push('executed gameplay/playtest evidence')
      if (missing.length > 0 && state.judgedGeneration !== state.generation) {
        state.judgedGeneration = state.generation
        agent.steer(createUserMessage({
          content: [{
            type: 'text',
            text: 'Game completion has three independent evidence gates after the latest mutation. Missing: ' + missing.join('; ') + '. A build/test cannot satisfy visual or play evidence, and a screenshot cannot substitute for actually playing the game. Run the current build/emulator, capture and inspect a fresh gameplay frame, and verify the player plus representative enemy and NPC/interactive actors. Primitive boxes/rectangles/capsules/debug shapes, dashboard-style placeholder UI, or unanimated provisional actors must be replaced before completion.',
          }],
          source: { kind: 'plugin', plugin: 'ordinary-completion-judge', form: 'notice', summary: 'game technical visual play verification required' },
        }))
        return
      }
    }
    if (state.verifiedGeneration !== state.generation || state.judgedGeneration === state.generation) return
    if (state.judgePasses >= maxPasses) return

    state.judgePasses += 1
    const decision = await reviewOrdinaryCompletion({
      subagents: input.subagents,
      provider: input.provider,
      parent: agent,
      request: state.request,
      mutations: state.mutations,
      verifications: state.verifications,
      signal,
    })
    state.judgedGeneration = state.generation
    if (decision.verdict !== 'pass') agent.steer(judgeNotice(decision))
  }))

  disposers.push(ctx.on('agent/disposed', ({ agent }) => {
    states.delete(agent)
  }))

  return () => {
    for (let index = disposers.length - 1; index >= 0; index--) disposers[index]?.()
  }
}

import { readFileSync, writeFileSync } from 'node:fs'

function edit(path, transform) {
  const before = readFileSync(path, 'utf8')
  const after = transform(before)
  if (after === before) throw new Error(`No change produced for ${path}`)
  writeFileSync(path, after)
}

edit('packages/goal/tool-goal/src/completion-gate.ts', (input) => {
  let s = input
  const llmImport = "import type { ContentBlock, LlmRuntime } from '@phoenix-ai/dsh-llm'\n"
  if (!s.includes("type LivingRegistry")) s = s.replace(llmImport, llmImport + "import { LivingCreationId, livingLevelRank, type LivingRegistry } from '@phoenix-ai/dsh-living'\n")
  s = s.replace(
    "const EXECUTION_TOOLS = ['bash', 'read', 'read_image', 'glob', 'grep'] as const",
    "const EXECUTION_TOOLS = ['bash', 'read', 'read_image', 'glob', 'grep', 'living_inspect_creation', 'living_read_state', 'living_verify_creation'] as const",
  )
  const runtime = "type CompletionRuntime = Pick<SubagentRuntime, 'getProvider' | 'start'>\n  & Partial<Pick<SubagentRuntime, 'list'>>\n"
  if (!s.includes('type LivingReadRuntime')) s = s.replace(runtime, runtime + "type LivingReadRuntime = Pick<LivingRegistry, 'inspect' | 'readState'>\n")
  const marker = '/** Run fresh independent adversarial and foresight verification for one completion attempt. */\n'
  if (!s.includes('async function verifyLivingEvidence(')) {
    const helper = `async function verifyLivingEvidence(\n  result: GoalCompletionGateResult,\n  living: LivingReadRuntime | undefined,\n): Promise<GoalCompletionGateResult> {\n  const scenarios: QualityScenario[] = []\n  const findings = [...result.findings]\n  let valid = true\n  for (const scenario of result.realWorldScenarios) {\n    if (scenario.evidenceKind !== 'live' || scenario.status !== 'pass') {\n      scenarios.push(scenario)\n      continue\n    }\n    const reference = scenario.authorityRef\n    if (reference === undefined || !reference.startsWith('living:') || reference.slice('living:'.length).trim().length === 0) {\n      valid = false\n      const blocker = \`Live scenario \${scenario.id} does not name a valid living:<creation-id> authority.\`\n      findings.push(blocker)\n      scenarios.push({ ...scenario, status: 'untested', blocker })\n      continue\n    }\n    if (living === undefined) {\n      valid = false\n      const blocker = \`Live scenario \${scenario.id} cannot be verified because the living registry is unavailable.\`\n      findings.push(blocker)\n      scenarios.push({ ...scenario, status: 'untested', blocker })\n      continue\n    }\n    const rawId = reference.slice('living:'.length)\n    try {\n      const id = LivingCreationId(rawId)\n      const snapshot = living.inspect(id)\n      if (!snapshot.connected) throw new Error(\`living creation \${rawId} is offline\`)\n      if (livingLevelRank(snapshot.achievedLevel) < livingLevelRank(snapshot.manifest.targetLevel)) {\n        throw new Error(\`living creation \${rawId} achieves \${snapshot.achievedLevel}, below target \${snapshot.manifest.targetLevel}\`)\n      }\n      if (snapshot.manifest.state.length > 0) await living.readState(id)\n      scenarios.push(scenario)\n    } catch (error) {\n      valid = false\n      const detail = error instanceof Error ? error.message : String(error)\n      const blocker = \`Live authority \${reference} failed verification: \${detail}\`.slice(0, MAX_TEXT)\n      findings.push(blocker)\n      scenarios.push({ ...scenario, status: 'untested', blocker })\n    }\n  }\n  return {\n    ...result,\n    foresightComplete: result.foresightComplete && valid,\n    realWorldScenarios: scenarios,\n    findings: findings.slice(0, MAX_ITEMS),\n  }\n}\n\n`
    if (!s.includes(marker)) throw new Error('completion gate insertion marker missing')
    s = s.replace(marker, helper + marker)
  }
  s = s.replace(
    "  readonly round: number\n  readonly signal: AbortSignal\n}): Promise<GoalCompletionGateResult> {",
    "  readonly round: number\n  readonly signal: AbortSignal\n  readonly living?: LivingReadRuntime\n}): Promise<GoalCompletionGateResult> {",
  )
  s = s.replace(
    "A live PASS is allowed only when an authoritative runtime/tool path was actually observed; provide authority_ref such as a concrete living/runtime/tool locator. Never call a mock, unit test, synthetic fixture, screenshot, or inference live evidence. '",
    "A live PASS is allowed only when an authoritative runtime/tool path was actually observed; for Phoenix-created systems use authority_ref exactly as living:<creation-id> after inspecting/verifying it with the read-only living tools. Never call a mock, unit test, synthetic fixture, screenshot, or inference live evidence. '",
  )
  s = s.replace(
    "  return readExecution(executed) ?? unavailable('Independent adversarial execution did not return valid clean-room evidence.')\n}",
    "  const parsed = readExecution(executed)\n  if (parsed === undefined) return unavailable('Independent adversarial execution did not return valid clean-room evidence.')\n  return verifyLivingEvidence(parsed, input.living)\n}",
  )
  return s
})

edit('packages/goal/tool-goal/src/judge.ts', (input) => {
  let s = input
  const llmImport = "import type { ContentBlock, LlmRuntime } from '@phoenix-ai/dsh-llm'\n"
  if (!s.includes("type { LivingRegistry }")) s = s.replace(llmImport, llmImport + "import type { LivingRegistry } from '@phoenix-ai/dsh-living'\n")
  const qualityType = "type GoalQualityRuntime = Pick<QualityService, 'get' | 'start' | 'record'>\n"
  if (!s.includes('type GoalLivingRuntime')) s = s.replace(qualityType, qualityType + "type GoalLivingRuntime = Pick<LivingRegistry, 'inspect' | 'readState'>\n")
  s = s.replace(
    "  readonly signal: AbortSignal\n  readonly quality?: GoalQualityRuntime\n}): Promise<GoalJudgeResult> {",
    "  readonly signal: AbortSignal\n  readonly quality?: GoalQualityRuntime\n  readonly living?: GoalLivingRuntime\n}): Promise<GoalJudgeResult> {",
  )
  s = s.replace(
    "    round: input.round,\n    signal: input.signal,\n  })",
    "    round: input.round,\n    signal: input.signal,\n    ...input.living === undefined ? {} : { living: input.living },\n  })",
  )
  return s
})

edit('packages/goal/tool-goal/src/index.ts', (input) => {
  let s = input
  const qualityLookup = "        const quality = ctx.get('quality', false)\n"
  if (!s.includes("const living = ctx.get('living', false)")) s = s.replace(qualityLookup, qualityLookup + "        const living = ctx.get('living', false)\n")
  const qualityArg = "          ...quality === undefined ? {} : { quality },\n"
  if (!s.includes("...living === undefined ? {} : { living },")) s = s.replace(qualityArg, qualityArg + "          ...living === undefined ? {} : { living },\n")
  return s
})

edit('packages/goal/tool-goal/package.json', (input) => {
  const pkg = JSON.parse(input)
  pkg.peerDependencies['@phoenix-ai/dsh-living'] = 'workspace:^'
  pkg.devDependencies['@phoenix-ai/dsh-living'] = 'workspace:^'
  return JSON.stringify(pkg, null, 2) + '\n'
})

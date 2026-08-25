from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one match, found {count}: {old!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


def insert_after_once(path: str, marker: str, addition: str) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    if addition in text:
        return
    if text.count(marker) != 1:
        raise SystemExit(f"{path}: insertion marker count != 1: {marker!r}")
    p.write_text(text.replace(marker, marker + addition, 1), encoding="utf-8")


# Package invariant contracts.
replace_once(
    "packages/bundle/phoenix/src/invariant.ts",
    "// Static profile bundle: mounted rows own their runtime invariants.\nconst install: InvariantInstaller = () => {}",
    "// No runtime invariant: mounted profile rows own their runtime invariants.\nconst install: InvariantInstaller = () => {}",
)
replace_once(
    "packages/phoenix/runtime/src/invariant.ts",
    "// ownership; deeper runtime assertions are added as public snapshots stabilize.\nconst install: InvariantInstaller = () => {}",
    "// No runtime invariant: this companion reserves ownership until public snapshots stabilize.\nconst install: InvariantInstaller = () => {}",
)
replace_once(
    "packages/phoenix/continuity/package.json",
    '  "files": ["lib/**/*.js", "lib/types/**/*.d.ts"],',
    '  "files": ["lib/**/*.js", "lib/invariant.js", "lib/types/**/*.d.ts"],',
)

# Source resolution for Loader/tsx launches and invariant companions.
insert_after_once(
    "tsconfig.base.json",
    '      "@deepseek-ai/dsh-invariants": ["./packages/runtime-diagnostics/invariants/src/index.ts"],\n',
    '      "@deepseek-ai/dsh-phoenix-ai-bus": ["./packages/phoenix/ai-bus/src/index.ts"],\n'
    '      "@deepseek-ai/dsh-phoenix-repo-brain": ["./packages/phoenix/repo-brain/src/index.ts"],\n'
    '      "@deepseek-ai/dsh-phoenix-runtime": ["./packages/phoenix/runtime/src/index.ts"],\n',
)
replace_once(
    "tsconfig.base.json",
    '        "./packages/test-support/*/src/invariant.ts"\n',
    '        "./packages/test-support/*/src/invariant.ts",\n        "./packages/phoenix/*/src/invariant.ts"\n',
)

# Bundle runtime dependencies are loaded declaratively by cordis.patch.yml;
# type-only imports make that manifest ownership visible to static analysis.
replace_once(
    "packages/bundle/phoenix/src/index.ts",
    "\nexport {}\n",
    "\nimport type {} from '@deepseek-ai/dsh-phoenix-ai-bus'\n"
    "import type {} from '@deepseek-ai/dsh-phoenix-repo-brain'\n"
    "import type {} from '@deepseek-ai/dsh-phoenix-runtime'\n"
    "import type {} from '@deepseek-ai/dsh-subagent-codex'\n"
    "import type {} from '@deepseek-ai/dsh-subagent-claude-code'\n\n"
    "export {}\n",
)

# Keep the existing client-artifact promoter as an explicit runnable entry point.
replace_once(
    "package.json",
    '    "phoenix:scope:check": "tsx scripts/plan-phoenix-scope-migration.ts --check"\n',
    '    "phoenix:scope:check": "tsx scripts/plan-phoenix-scope-migration.ts --check",\n'
    '    "phoenix:promote-client-artifacts": "tsx scripts/promote-client-artifacts.ts"\n',
)

# Structured-error public API documentation.
replace_once(
    "packages/client/ui-conversation/src/client/chat/structured-error.ts",
    "export interface StructuredErrorField {",
    "/** One labeled field extracted from a structured provider error. */\nexport interface StructuredErrorField {",
)
replace_once(
    "packages/client/ui-conversation/src/client/chat/structured-error.ts",
    "export interface StructuredErrorPresentation {",
    "/** Safe, localized presentation model for one structured provider error. */\nexport interface StructuredErrorPresentation {",
)
replace_once(
    "packages/client/ui-conversation/src/client/chat/structured-error.ts",
    "/** Translate only generic error prose, never identifiers, provider/model names, enum values, IDs or URLs. */\nexport function translateGenericErrorProse(value: string): string {",
    "/**\n * Translate only generic error prose, never identifiers, provider/model names, enum values, IDs or URLs.\n * @param value - Human-readable provider prose that may be localized.\n * @returns Localized prose while preserving technical identifiers verbatim.\n */\nexport function translateGenericErrorProse(value: string): string {",
)
replace_once(
    "packages/client/ui-conversation/src/client/chat/structured-error.ts",
    " * Arbitrary chat JSON is unaffected because callers use this only on error nodes.\n */\nexport function formatStructuredError(",
    " * Arbitrary chat JSON is unaffected because callers use this only on error nodes.\n * @param input - Error text containing a JSON object or array envelope.\n * @param explicitCode - Optional status/code supplied by the caller.\n * @returns A bounded localized presentation, or undefined when the input is not a structured error.\n */\nexport function formatStructuredError(",
)

# AI Bus exported API documentation and explicit default parameter type.
replace_once(
    "packages/phoenix/ai-bus/src/index.ts",
    "export type PhoenixComputeLane = 'local-free' | 'remote-free' | 'metered-or-unknown'",
    "/** Cost classification used to order authority-approved model routes. */\nexport type PhoenixComputeLane = 'local-free' | 'remote-free' | 'metered-or-unknown'",
)
replace_once("packages/phoenix/ai-bus/src/index.ts", "export interface PhoenixModelRef {", "/** Provider/model identity used by the AI Bus. */\nexport interface PhoenixModelRef {")
replace_once("packages/phoenix/ai-bus/src/index.ts", "export interface PhoenixRouteSnapshot extends PhoenixModelRef {", "/** Observed native DSH model route plus its PHOENIX cost lane. */\nexport interface PhoenixRouteSnapshot extends PhoenixModelRef {")
replace_once("packages/phoenix/ai-bus/src/index.ts", "export interface PhoenixAiBusConfig {", "/** Provider names used to classify local-free and explicitly remote-free routes. */\nexport interface PhoenixAiBusConfig {")
replace_once("packages/phoenix/ai-bus/src/index.ts", "export interface PiAiModelPreset {", "/** Minimal pi-ai model preset emitted by PHOENIX helpers. */\nexport interface PiAiModelPreset {")
replace_once("packages/phoenix/ai-bus/src/index.ts", "export interface PiAiProviderPreset {", "/** Provider preset compatible with the native pi-ai adapter. */\nexport interface PiAiProviderPreset {")
replace_once(
    "packages/phoenix/ai-bus/src/index.ts",
    "  baseURL = 'http://127.0.0.1:11434/v1',",
    "  baseURL: string = 'http://127.0.0.1:11434/v1',",
)

# Repo Brain exported API docs, config-field docs, and explicit public defaults.
replace_once(
    "packages/phoenix/repo-brain/src/index.ts",
    "/** Cap model-facing text by UTF-8 bytes without splitting a code point. */\nexport function capToolText(text: string, maxBytes: number): string {",
    "/**\n * Cap model-facing text by UTF-8 bytes without splitting a code point.\n * @param text - Complete tool text before bounding.\n * @param maxBytes - Maximum UTF-8 byte budget for the returned text.\n * @returns Original or safely truncated text within the requested byte budget.\n */\nexport function capToolText(text: string, maxBytes: number): string {",
)
replace_once(
    "packages/phoenix/repo-brain/src/index.ts",
    "export interface RepoBrainConfig {\n  root?: string\n  maxFiles?: number\n  maxFileBytes?: number\n  maxTermsPerFile?: number\n  defaultLimit?: number\n}",
    "/** Configuration for deterministic repository indexing and bounded retrieval. */\nexport interface RepoBrainConfig {\n  /** Repository root; defaults to the current working directory. */\n  root?: string\n  /** Maximum source/config/document files indexed per refresh. */\n  maxFiles?: number\n  /** Maximum bytes read from any individual indexed file. */\n  maxFileBytes?: number\n  /** Maximum normalized lexical terms retained per indexed file. */\n  maxTermsPerFile?: number\n  /** Default number of search or impact results returned to the model. */\n  defaultLimit?: number\n}",
)
replace_once("packages/phoenix/repo-brain/src/index.ts", "export interface RepoBrainSearchHit {", "/** Ranked lexical/structural repository search result. */\nexport interface RepoBrainSearchHit {")
replace_once("packages/phoenix/repo-brain/src/index.ts", "export interface RepoBrainImpactHit {", "/** Reverse-import dependency reached from an indexed target. */\nexport interface RepoBrainImpactHit {")
replace_once("packages/phoenix/repo-brain/src/index.ts", "export interface RepoBrainRefreshSummary {", "/** Incremental refresh accounting returned after rebuilding the index view. */\nexport interface RepoBrainRefreshSummary {")
replace_once("packages/phoenix/repo-brain/src/index.ts", "export interface RepoBrainStats {", "/** Compact index size and readiness statistics. */\nexport interface RepoBrainStats {")
replace_once(
    "packages/phoenix/repo-brain/src/index.ts",
    "/** Cheap symbol extraction intended for routing/retrieval, not compilation. */\nexport function extractSymbols(text: string, extension: string): string[] {",
    "/**\n * Cheap symbol extraction intended for routing/retrieval, not compilation.\n * @param text - Source or documentation text to inspect.\n * @param extension - Lowercase file extension selecting the lightweight extractor.\n * @returns Bounded unique symbol or heading names.\n */\nexport function extractSymbols(text: string, extension: string): string[] {",
)
replace_once(
    "packages/phoenix/repo-brain/src/index.ts",
    "/** Relative JS/TS import specs only; package imports are not repository edges. */\nexport function extractRelativeImportSpecs(text: string): string[] {",
    "/**\n * Extract relative JavaScript/TypeScript import specs only; package imports are not repository edges.\n * @param text - Source text whose import statements should be scanned.\n * @returns Bounded unique relative import specifiers.\n */\nexport function extractRelativeImportSpecs(text: string): string[] {",
)
replace_once(
    "packages/phoenix/repo-brain/src/index.ts",
    "  async refresh(): Promise<RepoBrainRefreshSummary> {",
    "  /** Refresh repository metadata and reread only changed indexed files.\n   * @returns Incremental refresh accounting for reread, reused, removed, and truncated files.\n   */\n  async refresh(): Promise<RepoBrainRefreshSummary> {",
)
replace_once(
    "packages/phoenix/repo-brain/src/index.ts",
    "  async search(query: string, limit = this.config.defaultLimit): Promise<RepoBrainSearchHit[]> {",
    "  /** Search the deterministic lexical/structural index.\n   * @param query - User/model query used to rank indexed paths and symbols.\n   * @param limit - Maximum number of ranked hits to return.\n   * @returns Ranked repository search hits.\n   */\n  async search(query: string, limit: number = this.config.defaultLimit): Promise<RepoBrainSearchHit[]> {",
)
replace_once(
    "packages/phoenix/repo-brain/src/index.ts",
    "  async impact(path: string, depth = 2, limit = MAX_TOOL_LIMIT): Promise<RepoBrainImpactHit[]> {",
    "  /** Walk reverse relative-import dependencies from one indexed path.\n   * @param path - Repository-relative indexed path to analyze.\n   * @param depth - Maximum reverse-dependency traversal depth.\n   * @param limit - Maximum number of impacted paths returned.\n   * @returns Bounded reverse-dependency hits ordered by traversal.\n   */\n  async impact(path: string, depth: number = 2, limit: number = MAX_TOOL_LIMIT): Promise<RepoBrainImpactHit[]> {",
)
replace_once(
    "packages/phoenix/repo-brain/src/index.ts",
    "  stats(): RepoBrainStats {",
    "  /** Report current in-process index size and readiness.\n   * @returns Current file, symbol, edge, and indexed-state counters.\n   */\n  stats(): RepoBrainStats {",
)
replace_once(
    "packages/phoenix/repo-brain/src/index.ts",
    "  readonly index: RepoBrainIndex",
    "  /** Deterministic in-process repository index owned by this service. */\n  readonly index: RepoBrainIndex",
)

# Runtime public surface documentation.
replace_once("packages/phoenix/runtime/src/index.ts", "export interface FlightRecord {", "/** One bounded Token Flight Recorder observation for an agent step. */\nexport interface FlightRecord {")
replace_once(
    "packages/phoenix/runtime/src/index.ts",
    "  readonly ladder: ModelCapabilityLadder = new ModelCapabilityLadder()\n  readonly flight: FlightRecord[] = []",
    "  /** Evidence-backed model capability and authority ladder. */\n  readonly ladder: ModelCapabilityLadder = new ModelCapabilityLadder()\n  /** Bounded in-memory token-pressure observations for recent agent steps. */\n  readonly flight: FlightRecord[] = []",
)

# Capability ladder public API documentation and explicit default types.
replace_once("packages/phoenix/runtime/src/model-ladder.ts", "export const capabilityDimensions = [", "/** Capability dimensions scored by PHOENIX evidence. */\nexport const capabilityDimensions = [")
replace_once("packages/phoenix/runtime/src/model-ladder.ts", "export type CapabilityDimension = typeof capabilityDimensions[number]", "/** One evidence dimension measured by the capability ladder. */\nexport type CapabilityDimension = typeof capabilityDimensions[number]")
replace_once("packages/phoenix/runtime/src/model-ladder.ts", "export const phoenixRoles = [", "/** Stable PHOENIX task roles used for weighted model ranking. */\nexport const phoenixRoles = [")
replace_once("packages/phoenix/runtime/src/model-ladder.ts", "export type PhoenixRole = typeof phoenixRoles[number]", "/** Role recognized by the deterministic PHOENIX task classifier. */\nexport type PhoenixRole = typeof phoenixRoles[number]")
replace_once("packages/phoenix/runtime/src/model-ladder.ts", "export type ModelTrust = 'provisional' | 'qualified' | 'quarantined'", "/** Routing authority state derived from evidence and quarantine policy. */\nexport type ModelTrust = 'provisional' | 'qualified' | 'quarantined'")
replace_once("packages/phoenix/runtime/src/model-ladder.ts", "export type EvidenceSource = 'benchmark' | 'mission' | 'collective-observation' | 'operator'", "/** Provenance category attached to every capability observation. */\nexport type EvidenceSource = 'benchmark' | 'mission' | 'collective-observation' | 'operator'")
replace_once("packages/phoenix/runtime/src/model-ladder.ts", "export interface ModelRef {", "/** Provider/model identity tracked independently from provider marketing labels. */\nexport interface ModelRef {")
replace_once("packages/phoenix/runtime/src/model-ladder.ts", "export interface CapabilityEvidence extends ModelRef {", "/** One scored capability observation with provenance and optional reproducibility metadata. */\nexport interface CapabilityEvidence extends ModelRef {")
replace_once("packages/phoenix/runtime/src/model-ladder.ts", "export interface DimensionSnapshot {", "/** Time-decayed score and confidence summary for one capability dimension. */\nexport interface DimensionSnapshot {")
replace_once("packages/phoenix/runtime/src/model-ladder.ts", "export interface ModelSnapshot extends ModelRef {", "/** Current trust and per-dimension evidence summary for one model. */\nexport interface ModelSnapshot extends ModelRef {")
replace_once("packages/phoenix/runtime/src/model-ladder.ts", "export interface RankedModel extends ModelRef {", "/** Qualified model candidate with role-specific score and confidence. */\nexport interface RankedModel extends ModelRef {")
replace_once(
    "packages/phoenix/runtime/src/model-ladder.ts",
    "export interface ModelLadderOptions {\n  halfLifeMs?: number\n  minimumConfidence?: number\n}",
    "/** Tuning knobs for evidence decay and minimum routing confidence. */\nexport interface ModelLadderOptions {\n  /** Half-life applied to time-decay of historical evidence. */\n  halfLifeMs?: number\n  /** Minimum confidence required before a qualified model may rank. */\n  minimumConfidence?: number\n}",
)
replace_once("packages/phoenix/runtime/src/model-ladder.ts", "  register(ref: ModelRef): void {", "  /** Register a discovered model as provisional when first seen.\n   * @param ref - Provider/model identity to track.\n   */\n  register(ref: ModelRef): void {")
replace_once("packages/phoenix/runtime/src/model-ladder.ts", "  record(evidence: CapabilityEvidence): void {", "  /** Record one capability observation and update evidence-derived trust.\n   * @param evidence - Scored observation to append to the model history.\n   */\n  record(evidence: CapabilityEvidence): void {")
replace_once("packages/phoenix/runtime/src/model-ladder.ts", "  quarantine(ref: ModelRef): void {", "  /** Quarantine a model so it cannot be selected by PHOENIX routing.\n   * @param ref - Provider/model identity to quarantine.\n   */\n  quarantine(ref: ModelRef): void {")
replace_once("packages/phoenix/runtime/src/model-ladder.ts", "  releaseQuarantine(ref: ModelRef): void {", "  /** Release quarantine while restoring only evidence-justified trust.\n   * @param ref - Provider/model identity whose quarantine should be cleared.\n   */\n  releaseQuarantine(ref: ModelRef): void {")
replace_once(
    "packages/phoenix/runtime/src/model-ladder.ts",
    "  snapshot(ref: ModelRef, now = Date.now()): ModelSnapshot | undefined {",
    "  /** Build a time-decayed snapshot for one tracked model.\n   * @param ref - Provider/model identity to summarize.\n   * @param now - Reference timestamp used for evidence decay.\n   * @returns Current trust/dimension snapshot, or undefined when unregistered.\n   */\n  snapshot(ref: ModelRef, now: number = Date.now()): ModelSnapshot | undefined {",
)
replace_once(
    "packages/phoenix/runtime/src/model-ladder.ts",
    "  all(now = Date.now()): ModelSnapshot[] {",
    "  /** Snapshot every registered model.\n   * @param now - Reference timestamp used for evidence decay.\n   * @returns Snapshots for all registered provider/model identities.\n   */\n  all(now: number = Date.now()): ModelSnapshot[] {",
)
replace_once(
    "packages/phoenix/runtime/src/model-ladder.ts",
    "  rank(role: PhoenixRole, candidates?: readonly ModelRef[], now = Date.now()): RankedModel[] {",
    "  /** Rank qualified candidates for one role using weighted evidence.\n   * @param role - PHOENIX role whose capability weights should be applied.\n   * @param candidates - Optional authority-approved candidate pool; defaults to all registered models.\n   * @param now - Reference timestamp used for evidence decay.\n   * @returns Qualified candidates ordered by score, confidence, and stable identity tie-breaks.\n   */\n  rank(role: PhoenixRole, candidates?: readonly ModelRef[], now: number = Date.now()): RankedModel[] {",
)

# Local-state and task-classifier public API docs.
replace_once("packages/phoenix/runtime/src/persistence.ts", "export interface PhoenixLocalState {", "/** Durable local PHOENIX evidence and quarantine state. */\nexport interface PhoenixLocalState {")
replace_once("packages/phoenix/runtime/src/persistence.ts", "export function readLocalState(path: string): PhoenixLocalState {", "/** Read local PHOENIX state fail-closed to an empty v1 snapshot on invalid data.\n * @param path - Local state file path.\n * @returns Parsed v1 state or a fresh empty state when unavailable/invalid.\n */\nexport function readLocalState(path: string): PhoenixLocalState {")
replace_once("packages/phoenix/runtime/src/persistence.ts", "export function writeLocalState(path: string, state: PhoenixLocalState): void {", "/** Atomically persist PHOENIX local state with restrictive filesystem modes.\n * @param path - Destination state file path.\n * @param state - Valid state snapshot to serialize.\n */\nexport function writeLocalState(path: string, state: PhoenixLocalState): void {")
replace_once("packages/phoenix/runtime/src/task-role.ts", "/** Deterministic, zero-token first-pass task classifier. */\nexport function classifyTaskRole(messages: readonly UserMessage[]): PhoenixRole {", "/** Deterministic, zero-token first-pass task classifier.\n * @param messages - User-visible messages used for lexical role classification.\n * @returns PHOENIX role selected by deterministic keyword precedence.\n */\nexport function classifyTaskRole(messages: readonly UserMessage[]): PhoenixRole {")
replace_once("packages/phoenix/runtime/src/task-role.ts", "/** Cheap tasks should not automatically spawn a separate model process. */\nexport function isTrivialDelegation(task: string, maxChars = 220): boolean {", "/** Cheap tasks should not automatically spawn a separate model process.\n * @param task - Delegation task text proposed for a subagent.\n * @param maxChars - Maximum length still eligible for trivial-task classification.\n * @returns True when the task is short and deterministic-tool-shaped.\n */\nexport function isTrivialDelegation(task: string, maxChars: number = 220): boolean {")

# Documentation contracts.
replace_once("packages/README.md", "PHOENIX downstream intelligence:", "PHOENIX intelligence:")
replace_once("packages/bundle/phoenix/README.md", "Repo Brain owns its repository guidance/tool", "Repo Brain owns its `repo_brain` repository guidance/tool")
replace_once("packages/bundle/phoenix/README.zh.md", "Repo Brain 拥有仓库提示和工具", "Repo Brain 拥有 `repo_brain` 仓库提示和工具")
replace_once(
    "packages/bundle/phoenix/README.md",
    "This v13 profile does not yet include Sandbox Farm orchestration, Memory Genome/Rebirth, Model Team Genome, automatic benchmark arena, MCP hibernation/Toolsmith, desktop Flight Deck, or collective observe-only transport. It deliberately contains no peer-to-peer executable evolution path and no silent paid-provider fallback.",
    "- **Composition gaps** — this v13 profile does not yet include Sandbox Farm orchestration, Memory Genome/Rebirth, Model Team Genome, automatic benchmark arena, MCP hibernation/Toolsmith, desktop Flight Deck, or collective observe-only transport. It deliberately contains no peer-to-peer executable evolution path and no silent paid-provider fallback.",
)
replace_once(
    "packages/bundle/phoenix/README.zh.md",
    "v13 profile 尚未包含 Sandbox Farm 编排、Memory Genome/Rebirth、Model Team Genome、自动 benchmark arena、MCP Hibernate/Toolsmith、桌面 Flight Deck 或 collective observe-only transport。它刻意不提供 peer-to-peer 可执行演进路径，也不会静默启用付费 provider fallback。",
    "- **组合缺口** — v13 profile 尚未包含 Sandbox Farm 编排、Memory Genome/Rebirth、Model Team Genome、自动 benchmark arena、MCP Hibernate/Toolsmith、桌面 Flight Deck 或 collective observe-only transport。它刻意不提供 peer-to-peer 可执行演进路径，也不会静默启用付费 provider fallback。",
)
replace_once("packages/phoenix/ai-bus/README.md", "Nothing directly. AI Bus registers no prompt text", "Nothing directly. `PhoenixAiBus` registers no prompt text")
replace_once("packages/phoenix/ai-bus/README.zh.md", "模型不会直接看到 AI Bus 新增的提示词或工具。", "模型不会直接看到 `PhoenixAiBus` 新增的提示词或工具。")


def reorder_continuity(path: str) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    model = text.index("## Model Experience\n")
    safety = text.index("## Safety and durability\n")
    limits = text.index("## Known Limitations and Deferred Work\n")
    if not (model < safety < limits):
        raise SystemExit(f"{path}: unexpected continuity H2 order")
    prefix = text[:model]
    model_block = text[model:safety]
    safety_block = text[safety:limits]
    limits_block = text[limits:]
    p.write_text(prefix + safety_block + model_block + limits_block, encoding="utf-8")


reorder_continuity("packages/phoenix/continuity/README.md")
reorder_continuity("packages/phoenix/continuity/README.zh.md")

runtime_en = Path("packages/phoenix/runtime/README.md")
text = runtime_en.read_text(encoding="utf-8")
marker = "## Model Experience\n"
if text.count(marker) != 1:
    raise SystemExit("runtime README Model Experience marker mismatch")
prefix = text[: text.index(marker)]
runtime_en.write_text(
    prefix
    + "## Model Experience\n\n"
    + "### Adaptive routing policy\n\n"
    + "#### What the model sees\n\n"
    + "No additional prompt prose is injected by default. `agent/request` routing and Mother Guard operate around existing DSH seams; the model only observes their normal selected-route or tool-denial outcomes.\n\n"
    + "#### Token effect\n\n"
    + "Direct prompt overhead is zero. Token Flight Recorder reads existing `ctx.tokenMeter` measurements locally, while deterministic task classification and evidence ranking issue no model calls.\n\n"
    + "#### KV Cache effect\n\n"
    + "PHOENIX does not rewrite the stable prompt prefix. A failover that selects another provider/model enters that route's cache domain, so cross-model KV reuse is never assumed.\n\n"
    + "## Known Limitations and Deferred Work\n\n"
    + "- **Deferred layers** — the initial runtime has no automated quality benchmark suite, pairwise Model Team Genome, distributed Evolution Mesh transport, or Windows desktop shell. Those remain separate PHOENIX layers and must preserve the same fail-closed authority boundary.\n",
    encoding="utf-8",
)

runtime_zh = Path("packages/phoenix/runtime/README.zh.md")
text = runtime_zh.read_text(encoding="utf-8")
if text.count(marker) != 1:
    raise SystemExit("runtime zh README Model Experience marker mismatch")
prefix = text[: text.index(marker)]
runtime_zh.write_text(
    prefix
    + "## Model Experience\n\n"
    + "### Adaptive routing policy\n\n"
    + "#### What the model sees\n\n"
    + "默认不注入额外 prompt 文本。`agent/request` 路由与 Mother Guard 工作在现有 DSH 接缝周围；模型只会看到正常的已选路由结果或工具拒绝结果。\n\n"
    + "#### Token effect\n\n"
    + "直接 prompt 开销为零。Token Flight Recorder 在本地读取现有 `ctx.tokenMeter` 测量；确定性任务分类和证据排名都不会额外调用模型。\n\n"
    + "#### KV Cache effect\n\n"
    + "PHOENIX 不改写稳定 prompt 前缀。若 failover 选择另一个 provider/model，请求会进入该路由自己的 cache domain，因此绝不假设跨模型 KV 可复用。\n\n"
    + "## Known Limitations and Deferred Work\n\n"
    + "- **延后层** — 初始 runtime 尚未包含自动质量 benchmark、成对 Model Team Genome、分布式 Evolution Mesh transport 或 Windows desktop shell。这些仍是独立 PHOENIX 层，并必须保持同一 fail-closed authority boundary。\n",
    encoding="utf-8",
)

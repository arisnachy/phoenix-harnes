import type { LocalModelCatalogEntry, LocalRuntimeManifest } from './types.js'

/** Qwen3.5 2B upstream native context, as published by Qwen and Ollama. */
export const QWEN_35_2B_NATIVE_CONTEXT_WINDOW = 262_144

/** Conservative default for a laptop until the actual available memory is known. */
export const DEFAULT_QWEN_35_2B_RUNTIME_CONTEXT_WINDOW = 16_384

/**
 * Resolve the operational Ollama context from the Phoenix Host environment.
 *
 * Native capacity and the RAM-allocated runtime context are different.
 * The override intentionally never enables >256K/YaRN, which needs a separate
 * compatible engine/configuration rather than a larger num_ctx alone.
 * Invalid values fall back to the safe default.
 */
export function resolveQwen35RuntimeContextWindow(
  configured: string | undefined = process.env['PHOENIX_LOCAL_CONTEXT_TOKENS'],
): number {
  if (configured === undefined || !/^\d+$/.test(configured.trim())) {
    return DEFAULT_QWEN_35_2B_RUNTIME_CONTEXT_WINDOW
  }
  const requested = Number(configured.trim())
  return Number.isSafeInteger(requested)
    && requested >= 4_096 && requested <= QWEN_35_2B_NATIVE_CONTEXT_WINDOW
    ? requested
    : DEFAULT_QWEN_35_2B_RUNTIME_CONTEXT_WINDOW
}

/**
 * Small CPU-first Ollama model already installed by the user.
 * Phoenix connects to the existing local Ollama service; it must never
 * re-download the model or delete it when the user disconnects Phoenix.
 */
const QWEN_35_2B_OLLAMA: LocalModelCatalogEntry = Object.freeze({
  id: 'qwen3.5-2b-ollama-q4-k-m',
  displayName: 'Qwen 3.5 2B Q4_K_M · Ollama',
  backend: 'ollama',
  ollamaModel: 'qwen3.5:2b-q4_K_M',
  sizeBytes: 2_000_000_000,
  estimatedRamBytes: 3_500_000_000,
  // Advertise the actual allocated context to pi-ai so context fitting and
  // Ollama's num_ctx use one number; never promise 262K without allocating it.
  contextWindow: resolveQwen35RuntimeContextWindow(),
  nativeContextWindow: QWEN_35_2B_NATIVE_CONTEXT_WINDOW,
  // Qwen's old 256-token default truncated otherwise healthy normal replies.
  // Local streaming may complete one extra pass; hosted providers are unchanged.
  maxTokens: 768,
  recommended: true,
})

const GEMMA_4_E2B_IT_Q4_0: LocalModelCatalogEntry = Object.freeze({
  id: 'gemma-4-e2b-it-q4-0',
  displayName: 'Gemma 4 E2B-it Q4_0',
  backend: 'llama-server',
  modelFileName: 'gemma-4-E2B-it-Q4_0.gguf',
  sourceUrl: 'https://huggingface.co/ggml-org/gemma-4-E2B-it-GGUF/resolve/64ef033dc9f85a88f88e70cceb0a7457366bea64/gemma-4-E2B-it-Q4_0.gguf?download=true',
  sha256: '8e30dff3ac4c8434c49a7036fa15564bdbb6044e42bf04550bf1a096ad7e6a52',
  sizeBytes: 2_841_481_184,
  estimatedRamBytes: 6_000_000_000,
  contextWindow: 131_072,
  maxTokens: 2_048,
  recommended: false,
})

const QWEN_35_4B_Q4_K_M: LocalModelCatalogEntry = Object.freeze({
  id: 'qwen3.5-4b-q4-k-m',
  displayName: 'Qwen3.5-4B Q4_K_M',
  backend: 'llama-server',
  modelFileName: 'Qwen_Qwen3.5-4B-Q4_K_M.gguf',
  sourceUrl: 'https://huggingface.co/bartowski/Qwen_Qwen3.5-4B-GGUF/resolve/ba06320255db2dbec194dad738d066be90dabf29/Qwen_Qwen3.5-4B-Q4_K_M.gguf?download=true',
  sha256: '13c16f426047e2de38cd075bdade4a7bcbc8c774384876f677740cda65f8a983',
  sizeBytes: 3_013_027_808,
  estimatedRamBytes: 8_500_000_000,
  contextWindow: 262_144,
  maxTokens: 2_048,
  recommended: false,
})

const WINDOWS_X64_LLAMA_CPP: LocalRuntimeManifest = Object.freeze({
  version: 'b10964',
  archiveName: 'llama-b10964-bin-win-cpu-x64.zip',
  sourceUrl: 'https://github.com/ggml-org/llama.cpp/releases/download/b10964/llama-b10964-bin-win-cpu-x64.zip',
  sha256: '917f39c076402c421224824607397af20f53625a60defc20e8dd22446bf4c5d7',
  archiveSizeBytes: 18_427_629,
  executableRelativePath: 'llama-server.exe',
})

const LOCAL_MODEL_CATALOG: readonly LocalModelCatalogEntry[] = Object.freeze([
  QWEN_35_2B_OLLAMA,
  GEMMA_4_E2B_IT_Q4_0,
  QWEN_35_4B_Q4_K_M,
])

/** Live Ollama models are discovered through the loopback daemon, never
 * through a fabricated cloud list. This registry is private to the Host. */
export interface OllamaDiscoveredModel {
  tag: string
  sizeBytes: number
  estimatedRamBytes: number
  contextWindow: number
  nativeContextWindow?: number
  maxTokens: number
}

const ollamaDiscovered = new Map<string, LocalModelCatalogEntry>()

export function validOllamaTag(tag: string): boolean {
  return tag.length > 0 && tag.length <= 160
    && /^[a-zA-Z0-9][a-zA-Z0-9._-]*(?:\/[a-zA-Z0-9][a-zA-Z0-9._-]*)*(?::[a-zA-Z0-9][a-zA-Z0-9._-]*)?$/u.test(tag)
}

export function registerOllamaCandidate(tag: string, metadata?: OllamaDiscoveredModel): LocalModelCatalogEntry {
  if (!validOllamaTag(tag)) throw new Error('Invalid local Ollama model tag')
  const existing = LOCAL_MODEL_CATALOG.find(entry => entry.backend === 'ollama' && entry.ollamaModel === tag)
  if (existing !== undefined) return existing
  const id = `ollama:${tag}`
  const previous = ollamaDiscovered.get(id)
  const capacity = metadata?.contextWindow ?? previous?.contextWindow ?? 4_096
  const entry: LocalModelCatalogEntry = {
    id, displayName: `${tag} · Ollama`, backend: 'ollama', ollamaModel: tag,
    sizeBytes: metadata?.sizeBytes ?? previous?.sizeBytes ?? 0,
    estimatedRamBytes: metadata?.estimatedRamBytes ?? previous?.estimatedRamBytes ?? 0,
    contextWindow: capacity,
    ...(metadata?.nativeContextWindow === undefined
      ? previous?.nativeContextWindow === undefined ? {} : { nativeContextWindow: previous.nativeContextWindow }
      : { nativeContextWindow: metadata.nativeContextWindow }),
    maxTokens: metadata?.maxTokens ?? previous?.maxTokens ?? 512,
    recommended: false,
  }
  ollamaDiscovered.set(id, entry)
  return entry
}

/** A refresh also evicts models physically removed outside PHOENIX. */
export function synchronizeOllamaCatalog(models: readonly OllamaDiscoveredModel[]): string[] {
  const active = new Set<string>()
  const installed: string[] = []
  for (const metadata of models.slice(0, 128)) {
    if (!validOllamaTag(metadata.tag)) continue
    const entry = registerOllamaCandidate(metadata.tag, metadata)
    active.add(entry.id)
    installed.push(entry.id)
  }
  for (const id of ollamaDiscovered.keys()) {
    if (!active.has(id)) ollamaDiscovered.delete(id)
  }
  return installed
}

export function forgetOllamaCandidate(modelId: string): void {
  ollamaDiscovered.delete(modelId)
}

/** Stable id of the model Phoenix Local selects on first use. */
export const DEFAULT_LOCAL_MODEL_ID = QWEN_35_2B_OLLAMA.id

/**
 * Return Phoenix's immutable catalog of supported local models.
 * @returns The supported Phoenix Local model catalog.
 */
export function getLocalModelCatalog(): readonly LocalModelCatalogEntry[] {
  return [...LOCAL_MODEL_CATALOG, ...ollamaDiscovered.values()]
}

/**
 * Resolve one local-model catalog entry by id.
 * @param modelId - Stable Phoenix Local model identifier.
 * @returns The matching catalog entry, when supported.
 */
export function getLocalModel(modelId: string): LocalModelCatalogEntry | undefined {
  return LOCAL_MODEL_CATALOG.find(entry => entry.id === modelId) ?? ollamaDiscovered.get(modelId)
}

/**
 * Return the pinned llama.cpp runtime manifest for a verified target.
 * @param platform - Node platform identifier.
 * @param arch - Node architecture identifier.
 * @returns The verified runtime manifest for the target, when supported.
 */
export function getRuntimeManifest(platform: string, arch: string): LocalRuntimeManifest | undefined {
  if (platform === 'win32' && arch === 'x64') return WINDOWS_X64_LLAMA_CPP
  return undefined
}

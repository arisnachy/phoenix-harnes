import type { OpenClawExtensionCatalogEntry } from './catalog.ts'

export type PhoenixOpenClawCapabilityKind =
  | 'agent-protocol'
  | 'memory'
  | 'device'
  | 'computer-use'
  | 'secrets'
  | 'work'
  | 'integration'
  | 'web-search'
  | 'document'
  | 'voice'
  | 'media'
  | 'observability'
  | 'coding'
  | 'channel'
  | 'model-provider'
  | 'local-inference'
  | 'extension'

export interface PhoenixOpenClawCapability {
  id: string
  extensionId: string
  kind: PhoenixOpenClawCapabilityKind
  source: 'openclaw'
}

const FAMILY_MEMBERS: Readonly<Record<Exclude<PhoenixOpenClawCapabilityKind, 'extension'>, readonly string[]>> = {
  'agent-protocol': ['a2a', 'acpx', 'llm-task'],
  memory: ['active-memory', 'logbook', 'memory-core', 'memory-lancedb', 'memory-wiki'],
  device: ['device-pair', 'geolocation', 'linux-node'],
  'computer-use': ['browser', 'cua-computer'],
  secrets: ['onepassword', 'vault'],
  work: ['workboard'],
  integration: ['admin-http-rpc', 'file-transfer', 'webhooks'],
  'web-search': ['brave', 'duckduckgo', 'exa', 'firecrawl', 'perplexity', 'searxng', 'tavily'],
  document: ['document-extract', 'web-readability'],
  voice: [
    'azure-speech',
    'deepgram',
    'elevenlabs',
    'fish-audio-speech',
    'gradium',
    'inworld',
    'senseaudio',
    'talk-voice',
    'tts-local-cli',
    'voice-call',
  ],
  media: ['comfy', 'fal', 'image-generation-core', 'pixverse', 'runway'],
  observability: ['diagnostics-otel', 'diagnostics-prometheus'],
  coding: [
    'codex',
    'copilot',
    'copilot-proxy',
    'github-copilot',
    'kilocode',
    'kimi-coding',
    'opencode',
    'opencode-go',
  ],
  channel: [
    'discord',
    'feishu',
    'google-meet',
    'googlechat',
    'imap',
    'imessage',
    'irc',
    'line',
    'matrix',
    'mattermost',
    'msteams',
    'nextcloud-talk',
    'nostr',
    'signal',
    'slack',
    'sms',
    'synology-chat',
    'teams-meetings',
    'telegram',
    'tlon',
    'twitch',
    'whatsapp',
    'zalo',
    'zalouser',
    'zoom-meetings',
  ],
  'model-provider': [
    'alibaba',
    'amazon-bedrock',
    'amazon-bedrock-mantle',
    'anthropic',
    'anthropic-vertex',
    'arcee',
    'baseten',
    'beam',
    'byteplus',
    'cerebras',
    'chutes',
    'cloudflare-ai-gateway',
    'cohere',
    'deepinfra',
    'deepseek',
    'featherless',
    'fireworks',
    'gmi',
    'google',
    'groq',
    'huggingface',
    'litellm',
    'longcat',
    'meta',
    'microsoft',
    'microsoft-foundry',
    'minimax',
    'mistral',
    'moonshot',
    'novita',
    'nvidia',
    'openai',
    'openrouter',
    'parallel',
    'qianfan',
    'qwen',
    'stepfun',
    'synthetic',
    'tencent',
    'together',
    'venice',
    'vercel-ai-gateway',
    'volcengine',
    'voyage',
    'xai',
    'xiaomi',
    'zai',
  ],
  'local-inference': ['llama-cpp', 'lmstudio', 'ollama', 'sglang', 'vllm'],
}

const KIND_BY_EXTENSION = new Map<string, PhoenixOpenClawCapabilityKind>()
for (const [kind, ids] of Object.entries(FAMILY_MEMBERS) as Array<[
  Exclude<PhoenixOpenClawCapabilityKind, 'extension'>,
  readonly string[],
]>) {
  for (const id of ids) KIND_BY_EXTENSION.set(id, kind)
}

export function toPhoenixCapabilities(
  entry: Pick<OpenClawExtensionCatalogEntry, 'id'>,
): PhoenixOpenClawCapability[] {
  return [{
    id: `openclaw:${entry.id}`,
    extensionId: entry.id,
    kind: KIND_BY_EXTENSION.get(entry.id) ?? 'extension',
    source: 'openclaw',
  }]
}

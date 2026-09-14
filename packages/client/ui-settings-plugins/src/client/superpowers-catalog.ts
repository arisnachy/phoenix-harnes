/**
 * Provider-neutral catalog for Phoenix power capabilities.
 *
 * This file is intentionally descriptive: a catalog entry never grants a
 * capability by itself. `status` is the trust boundary used by the UI and by
 * callers that need to decide whether Phoenix may invoke a capability now.
 */

export type SuperpowerKind = 'native' | 'workflow' | 'oauth' | 'api' | 'mcp'
export type SuperpowerStatus = 'native' | 'available' | 'configuration_required' | 'adapter_pending'
export type SuperpowerCategory =
  | 'core'
  | 'development'
  | 'security'
  | 'data'
  | 'documents'
  | 'meetings'
  | 'cloud'
  | 'finance'
  | 'productivity'
  | 'ai-media'

export interface SuperpowerCapability {
  id: string
  name: string
  category: SuperpowerCategory
  kind: SuperpowerKind
  status: SuperpowerStatus
  description: string
  tags: readonly string[]
}

export interface SuperpowerPreset {
  id: string
  name: string
  description: string
  capabilities: readonly string[]
}

/**
 * Catalog entries describe either a capability Phoenix already owns or an
 * integration target. External providers remain non-invokable until an actual
 * adapter/configuration changes their runtime status; showing a card is never
 * treated as proof of connectivity.
 */
export const SUPERPOWER_CATALOG: readonly SuperpowerCapability[] = [
  {
    id: 'agent-orchestration',
    name: 'Agent orchestration',
    category: 'core',
    kind: 'native',
    status: 'native',
    description: 'Phoenix native agent loop, tool dispatch and parallel-safe execution controls.',
    tags: ['agents', 'orchestration', 'native'],
  },
  {
    id: 'shell-execution',
    name: 'Shell execution',
    category: 'development',
    kind: 'native',
    status: 'native',
    description: 'Native command execution governed by Phoenix timeout and output safety limits.',
    tags: ['shell', 'automation', 'native'],
  },
  {
    id: 'web-research',
    name: 'Web research',
    category: 'data',
    kind: 'api',
    status: 'configuration_required',
    description: 'Search and evidence gathering through the configured web-search provider.',
    tags: ['search', 'research', 'evidence'],
  },
  {
    id: 'codex-security',
    name: 'Codex Security',
    category: 'security',
    kind: 'workflow',
    status: 'configuration_required',
    description: 'Security-focused coding workflow for threat review, dependency risk, hardening and remediation verification.',
    tags: ['security', 'review', 'remediation'],
  },
  {
    id: 'data-analytics',
    name: 'Data Analytics',
    category: 'data',
    kind: 'workflow',
    status: 'configuration_required',
    description: 'Analysis workspace for tabular data, statistics, visualizations and reproducible analytical runs.',
    tags: ['analytics', 'statistics', 'charts'],
  },
  {
    id: 'pdf',
    name: 'PDF workspace',
    category: 'documents',
    kind: 'workflow',
    status: 'configuration_required',
    description: 'PDF reading, extraction, transformation and publication workflow once a document adapter is configured.',
    tags: ['pdf', 'documents', 'reports'],
  },
  {
    id: 'presentations',
    name: 'Presentations',
    category: 'documents',
    kind: 'workflow',
    status: 'configuration_required',
    description: 'Presentation planning, generation and revision surface backed by a configured artifact provider.',
    tags: ['slides', 'pptx', 'presentations'],
  },
  {
    id: 'github',
    name: 'GitHub',
    category: 'development',
    kind: 'oauth',
    status: 'configuration_required',
    description: 'Repositories, branches, commits, pull requests, issues and code-review workflows.',
    tags: ['git', 'code', 'pull-requests'],
  },
  {
    id: 'vercel',
    name: 'Vercel',
    category: 'development',
    kind: 'api',
    status: 'configuration_required',
    description: 'Deployments, projects and web delivery workflows.',
    tags: ['deploy', 'web', 'hosting'],
  },
  {
    id: 'linear',
    name: 'Linear',
    category: 'productivity',
    kind: 'oauth',
    status: 'configuration_required',
    description: 'Issues, projects, planning and engineering execution tracking.',
    tags: ['issues', 'planning', 'projects'],
  },
  {
    id: 'devpost',
    name: 'Devpost',
    category: 'development',
    kind: 'api',
    status: 'adapter_pending',
    description: 'Hackathon discovery, registration, build assistance and submission workflows; Phoenix adapter is not wired yet.',
    tags: ['hackathons', 'submissions', 'builders'],
  },
  {
    id: 'supabase',
    name: 'Supabase',
    category: 'cloud',
    kind: 'api',
    status: 'configuration_required',
    description: 'Postgres, authentication, storage, realtime and edge-function workflows.',
    tags: ['database', 'auth', 'storage'],
  },
  {
    id: 'neon',
    name: 'Neon',
    category: 'cloud',
    kind: 'api',
    status: 'configuration_required',
    description: 'Serverless Postgres projects, branches, computes and database operations.',
    tags: ['postgres', 'database', 'serverless'],
  },
  {
    id: 'firebase',
    name: 'Firebase',
    category: 'cloud',
    kind: 'api',
    status: 'adapter_pending',
    description: 'Firebase application services target; requires a Phoenix adapter before invocation.',
    tags: ['firebase', 'apps', 'cloud'],
  },
  {
    id: 'posthog',
    name: 'PostHog',
    category: 'data',
    kind: 'api',
    status: 'configuration_required',
    description: 'Product analytics, feature flags, experiments, surveys and observability.',
    tags: ['analytics', 'experiments', 'telemetry'],
  },
  {
    id: 'notion',
    name: 'Notion',
    category: 'productivity',
    kind: 'oauth',
    status: 'configuration_required',
    description: 'Workspace search, project documentation, knowledge bases and task workflows.',
    tags: ['docs', 'knowledge', 'tasks'],
  },
  {
    id: 'sharepoint',
    name: 'Microsoft SharePoint',
    category: 'documents',
    kind: 'oauth',
    status: 'configuration_required',
    description: 'Enterprise documents, sites and OneDrive-backed collaboration content.',
    tags: ['microsoft', 'files', 'enterprise'],
  },
  {
    id: 'microsoft-teams',
    name: 'Microsoft Teams',
    category: 'meetings',
    kind: 'oauth',
    status: 'adapter_pending',
    description: 'Teams meetings, chats and collaboration target; requires a Phoenix adapter before invocation.',
    tags: ['teams', 'meetings', 'chat'],
  },
  {
    id: 'zoom',
    name: 'Zoom',
    category: 'meetings',
    kind: 'oauth',
    status: 'adapter_pending',
    description: 'Meetings and conferencing target; requires a Phoenix adapter before invocation.',
    tags: ['zoom', 'meetings', 'video'],
  },
  {
    id: 'google-workspace',
    name: 'Google Workspace',
    category: 'productivity',
    kind: 'oauth',
    status: 'configuration_required',
    description: 'Gmail, Calendar, Drive and collaborative workspace workflows after account authorization.',
    tags: ['google', 'mail', 'calendar', 'drive'],
  },
  {
    id: 'hugging-face',
    name: 'Hugging Face',
    category: 'ai-media',
    kind: 'api',
    status: 'configuration_required',
    description: 'Models, datasets, Spaces and machine-learning research resources.',
    tags: ['models', 'datasets', 'ml'],
  },
  {
    id: 'canva',
    name: 'Canva',
    category: 'ai-media',
    kind: 'oauth',
    status: 'configuration_required',
    description: 'Visual design and asset workflows through an authenticated provider.',
    tags: ['design', 'visuals', 'assets'],
  },
  {
    id: 'heygen',
    name: 'HeyGen',
    category: 'ai-media',
    kind: 'api',
    status: 'configuration_required',
    description: 'AI video, avatars, voices and translation workflows.',
    tags: ['video', 'avatar', 'voice'],
  },
  {
    id: 'binance',
    name: 'Binance market data',
    category: 'finance',
    kind: 'api',
    status: 'configuration_required',
    description: 'Read-only crypto market prices, order books, trades and historical candles.',
    tags: ['finance', 'crypto', 'market-data'],
  },
  {
    id: 'finance-data',
    name: 'Financial Data',
    category: 'finance',
    kind: 'mcp',
    status: 'configuration_required',
    description: 'Provider-neutral market, portfolio and financial research capability through a configured connector.',
    tags: ['markets', 'portfolio', 'research'],
  },
] as const

export const SUPERPOWER_PRESETS: readonly SuperpowerPreset[] = [
  {
    id: 'default',
    name: 'Default',
    description: 'Balanced everyday Phoenix toolkit.',
    capabilities: ['agent-orchestration', 'shell-execution', 'web-research', 'github', 'google-workspace'],
  },
  {
    id: 'development',
    name: 'Development',
    description: 'Code, repositories, deployment, databases and hackathon delivery.',
    capabilities: ['agent-orchestration', 'shell-execution', 'github', 'vercel', 'linear', 'devpost', 'supabase', 'neon', 'firebase'],
  },
  {
    id: 'security',
    name: 'Security',
    description: 'Security review and remediation with source-control evidence.',
    capabilities: ['codex-security', 'shell-execution', 'github', 'web-research'],
  },
  {
    id: 'data-analytics',
    name: 'Data Analytics',
    description: 'Research, analysis, experimentation and product telemetry.',
    capabilities: ['data-analytics', 'web-research', 'posthog', 'supabase', 'neon'],
  },
  {
    id: 'documents',
    name: 'Documents',
    description: 'Reports, PDFs, knowledge bases and enterprise files.',
    capabilities: ['pdf', 'notion', 'sharepoint', 'google-workspace'],
  },
  {
    id: 'presentations',
    name: 'Presentations',
    description: 'Slides and visual storytelling workflows.',
    capabilities: ['presentations', 'canva', 'google-workspace'],
  },
  {
    id: 'meetings',
    name: 'Meetings',
    description: 'Calendar, conferencing and collaboration surfaces.',
    capabilities: ['google-workspace', 'microsoft-teams', 'zoom', 'notion'],
  },
  {
    id: 'cloud-data',
    name: 'Cloud & Data',
    description: 'Application backends, databases, deployment and analytics.',
    capabilities: ['supabase', 'neon', 'firebase', 'vercel', 'posthog'],
  },
  {
    id: 'finance',
    name: 'Finance',
    description: 'Market data and provider-neutral financial research.',
    capabilities: ['binance', 'finance-data', 'data-analytics', 'web-research'],
  },
  {
    id: 'ai-media',
    name: 'AI & Media',
    description: 'Models, design, video and presentation creation.',
    capabilities: ['hugging-face', 'canva', 'heygen', 'presentations'],
  },
] as const

/** True only when the catalog truthfully says Phoenix may invoke it now. */
export function canInvokeSuperpower(capability: SuperpowerCapability): boolean {
  return capability.status === 'native' || capability.status === 'available'
}

/** Resolve a named preset without silently falling back to another profile. */
export function getSuperpowerPreset(id: string): SuperpowerPreset | undefined {
  return SUPERPOWER_PRESETS.find(preset => preset.id === id)
}

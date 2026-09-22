/** Secret-free catalog metadata for the Settings → Connectors hub. */

/** Configuration path a catalog connector expects once its adapter is installed. */
export type ConnectorMode = 'oauth' | 'api-key' | 'mcp' | 'native'

/** One discoverable external or local integration. */
export interface ConnectorDefinition {
  readonly id: string
  readonly aliases?: readonly string[]
  readonly name: string
  readonly category: string
  readonly description: string
  readonly mode: ConnectorMode
  readonly providerFamily?: string
  readonly logoUrl?: string
  readonly capabilities: readonly string[]
}

/** A native Phoenix capability bundle; presets never impersonate an external connection. */
export interface ConnectorPreset {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly kind: 'native-preset'
  readonly capabilities: readonly string[]
  readonly recommendedConnectors: readonly string[]
}

const icon = (slug: string): string => `https://cdn.simpleicons.org/${slug}`

/** Curated connector directory. Runtime state is joined separately from authorization/MCP telemetry. */
export const CONNECTOR_CATALOG: readonly ConnectorDefinition[] = [
  { id: 'gmail', name: 'Gmail', category: 'Email', description: 'Read, search, draft, send, label, and organize email.', mode: 'oauth', providerFamily: 'google', logoUrl: icon('gmail'), capabilities: ['mail.read', 'mail.write', 'mail.search'] },
  { id: 'google-calendar', aliases: ['calendar'], name: 'Google Calendar', category: 'Calendar', description: 'Read availability and create or update calendar events.', mode: 'oauth', providerFamily: 'google', logoUrl: icon('googlecalendar'), capabilities: ['calendar.read', 'calendar.write'] },
  { id: 'google-drive', aliases: ['drive'], name: 'Google Drive', category: 'Files', description: 'Search and work with Drive, Docs, Sheets, Slides, and files.', mode: 'oauth', providerFamily: 'google', logoUrl: icon('googledrive'), capabilities: ['files.read', 'files.write', 'documents'] },
  { id: 'google-contacts', aliases: ['contacts'], name: 'Google Contacts', category: 'Contacts', description: 'Find contacts, email addresses, phones, and organizations.', mode: 'oauth', providerFamily: 'google', logoUrl: icon('googlecontacts'), capabilities: ['contacts.read'] },
  { id: 'outlook-mail', name: 'Outlook Mail', category: 'Email', description: 'Read, search, draft, and send Microsoft 365 email.', mode: 'oauth', providerFamily: 'microsoft', logoUrl: icon('microsoftoutlook'), capabilities: ['mail.read', 'mail.write'] },
  { id: 'outlook-calendar', name: 'Outlook Calendar', category: 'Calendar', description: 'Read availability and manage Microsoft 365 meetings.', mode: 'oauth', providerFamily: 'microsoft', logoUrl: icon('microsoftoutlook'), capabilities: ['calendar.read', 'calendar.write'] },
  { id: 'onedrive', name: 'OneDrive', category: 'Files', description: 'Search, read, create, and manage OneDrive files.', mode: 'oauth', providerFamily: 'microsoft', logoUrl: icon('microsoftonedrive'), capabilities: ['files.read', 'files.write'] },
  { id: 'sharepoint', name: 'SharePoint', category: 'Knowledge', description: 'Work with SharePoint sites, libraries, and enterprise documents.', mode: 'oauth', providerFamily: 'microsoft', logoUrl: icon('microsoftsharepoint'), capabilities: ['files.read', 'files.write', 'knowledge'] },
  { id: 'box', name: 'Box', category: 'Files', description: 'Search and work with Box documents and folders.', mode: 'oauth', providerFamily: 'box', logoUrl: icon('box'), capabilities: ['files.read', 'files.write'] },
  { id: 'dropbox', name: 'Dropbox', category: 'Files', description: 'Search and work with Dropbox files and folders.', mode: 'oauth', providerFamily: 'dropbox', logoUrl: icon('dropbox'), capabilities: ['files.read', 'files.write'] },
  { id: 'notion', name: 'Notion', category: 'Knowledge', description: 'Search, create, and update pages, databases, and workspace knowledge.', mode: 'oauth', providerFamily: 'notion', logoUrl: icon('notion'), capabilities: ['knowledge.read', 'knowledge.write'] },
  { id: 'slack', name: 'Slack', category: 'Communication', description: 'Search channels and messages and collaborate with teams.', mode: 'oauth', providerFamily: 'slack', logoUrl: icon('slack'), capabilities: ['messages.read', 'messages.write'] },
  { id: 'microsoft-teams', aliases: ['teams'], name: 'Microsoft Teams', category: 'Communication', description: 'Work with teams, chats, channels, meetings, and collaboration.', mode: 'oauth', providerFamily: 'microsoft', logoUrl: icon('microsoftteams'), capabilities: ['messages.read', 'messages.write', 'meetings'] },
  { id: 'zoom', name: 'Zoom', category: 'Meetings', description: 'Manage meetings, recordings, and meeting metadata.', mode: 'oauth', providerFamily: 'zoom', logoUrl: icon('zoom'), capabilities: ['meetings.read', 'meetings.write'] },
  { id: 'github', name: 'GitHub', category: 'Development', description: 'Work with repositories, commits, issues, pull requests, and CI.', mode: 'oauth', providerFamily: 'github', logoUrl: icon('github'), capabilities: ['code.read', 'code.write', 'issues', 'pull-requests', 'ci'] },
  { id: 'linear', name: 'Linear', category: 'Development', description: 'Search, create, and update issues, projects, and initiatives.', mode: 'oauth', providerFamily: 'linear', logoUrl: icon('linear'), capabilities: ['issues', 'projects'] },
  { id: 'jira', name: 'Jira', category: 'Development', description: 'Work with issues, projects, boards, and engineering workflows.', mode: 'oauth', providerFamily: 'jira', logoUrl: icon('jira'), capabilities: ['issues', 'projects'] },
  { id: 'vercel', name: 'Vercel', category: 'Deploy', description: 'Build, inspect, and deploy web applications and agents.', mode: 'oauth', providerFamily: 'vercel', logoUrl: icon('vercel'), capabilities: ['deployments', 'hosting'] },
  { id: 'firebase', name: 'Firebase', category: 'Cloud', description: 'Work with Firebase projects, hosting, databases, auth, and functions.', mode: 'oauth', providerFamily: 'google', logoUrl: icon('firebase'), capabilities: ['database', 'auth', 'hosting', 'functions'] },
  { id: 'supabase', name: 'Supabase', category: 'Database', description: 'Manage Postgres, auth, storage, realtime, and Edge Functions.', mode: 'mcp', providerFamily: 'supabase', logoUrl: icon('supabase'), capabilities: ['database', 'auth', 'storage', 'functions'] },
  { id: 'neon', name: 'Neon', category: 'Database', description: 'Manage serverless PostgreSQL projects, branches, and computes.', mode: 'mcp', providerFamily: 'neon', logoUrl: icon('neon'), capabilities: ['database', 'postgres'] },
  { id: 'mongodb', name: 'MongoDB', category: 'Database', description: 'Inspect and operate MongoDB databases and Atlas resources.', mode: 'mcp', providerFamily: 'mongodb', logoUrl: icon('mongodb'), capabilities: ['database'] },
  { id: 'snowflake', name: 'Snowflake', category: 'Data', description: 'Query warehouses and analyze governed enterprise data.', mode: 'mcp', providerFamily: 'snowflake', logoUrl: icon('snowflake'), capabilities: ['sql', 'analytics'] },
  { id: 'bigquery', name: 'BigQuery', category: 'Data', description: 'Query and analyze Google Cloud data warehouses.', mode: 'oauth', providerFamily: 'google', logoUrl: icon('googlebigquery'), capabilities: ['sql', 'analytics'] },
  { id: 'posthog', name: 'PostHog', category: 'Analytics', description: 'Use product analytics, funnels, experiments, flags, logs, and surveys.', mode: 'mcp', providerFamily: 'posthog', logoUrl: icon('posthog'), capabilities: ['analytics', 'experiments', 'feature-flags'] },
  { id: 'sentry', name: 'Sentry', category: 'Observability', description: 'Inspect application errors, traces, releases, and performance.', mode: 'mcp', providerFamily: 'sentry', logoUrl: icon('sentry'), capabilities: ['errors', 'traces', 'observability'] },
  { id: 'cloudflare', name: 'Cloudflare', category: 'Cloud', description: 'Manage Workers, domains, DNS, deployments, and edge services.', mode: 'api-key', providerFamily: 'cloudflare', logoUrl: icon('cloudflare'), capabilities: ['edge', 'dns', 'deployments'] },
  { id: 'hugging-face', aliases: ['huggingface'], name: 'Hugging Face', category: 'AI', description: 'Inspect models, datasets, Spaces, and research artifacts.', mode: 'api-key', providerFamily: 'hugging-face', logoUrl: icon('huggingface'), capabilities: ['models', 'datasets', 'research'] },
  { id: 'canva', name: 'Canva', category: 'Design', description: 'Create, refine, resize, and review visual designs.', mode: 'oauth', providerFamily: 'canva', logoUrl: icon('canva'), capabilities: ['design', 'presentations'] },
  { id: 'figma', name: 'Figma', category: 'Design', description: 'Read design context and collaborate on product design assets.', mode: 'oauth', providerFamily: 'figma', logoUrl: icon('figma'), capabilities: ['design', 'ui'] },
  { id: 'heygen', name: 'HeyGen', category: 'Video AI', description: 'Create AI videos, avatars, voices, translations, and media.', mode: 'api-key', providerFamily: 'heygen', logoUrl: icon('heygen'), capabilities: ['video', 'voice', 'avatars'] },
  { id: 'magnific', name: 'Magnific', category: 'Multimedia', description: 'Generate, enhance, upscale, relight, and transform visual media.', mode: 'api-key', providerFamily: 'magnific', capabilities: ['image', 'video', 'upscale'] },
  { id: 'coursera', name: 'Coursera', category: 'Education', description: 'Find learning content and relevant lecture videos.', mode: 'oauth', providerFamily: 'coursera', logoUrl: icon('coursera'), capabilities: ['learning', 'courses'] },
  { id: 'devpost', name: 'Devpost', category: 'Development', description: 'Find hackathons and manage projects, builds, and submissions.', mode: 'oauth', providerFamily: 'devpost', logoUrl: icon('devpost'), capabilities: ['hackathons', 'submissions', 'projects'] },
  { id: 'apollo', aliases: ['apollo-io'], name: 'Apollo.io', category: 'Sales', description: 'Search, enrich, and qualify accounts and contacts for outbound work.', mode: 'api-key', providerFamily: 'apollo', capabilities: ['sales', 'prospecting', 'enrichment'] },
  { id: 'salesforce', name: 'Salesforce', category: 'CRM', description: 'Work with CRM accounts, contacts, opportunities, and workflows.', mode: 'oauth', providerFamily: 'salesforce', logoUrl: icon('salesforce'), capabilities: ['crm', 'sales'] },
  { id: 'hubspot', name: 'HubSpot', category: 'CRM', description: 'Work with CRM records, marketing, sales, and service workflows.', mode: 'oauth', providerFamily: 'hubspot', logoUrl: icon('hubspot'), capabilities: ['crm', 'marketing', 'sales'] },
  { id: 'twilio', name: 'Twilio', category: 'Communication', description: 'Send messages and integrate programmable communications.', mode: 'api-key', providerFamily: 'twilio', logoUrl: icon('twilio'), capabilities: ['sms', 'communications'] },
  { id: 'binance', name: 'Binance', category: 'Finance', description: 'Read market prices, candles, order books, trades, and exchange metadata.', mode: 'api-key', providerFamily: 'binance', logoUrl: icon('binance'), capabilities: ['markets', 'crypto', 'price-data'] },
  { id: 'stripe', name: 'Stripe', category: 'Finance', description: 'Inspect payments, customers, subscriptions, invoices, and revenue data.', mode: 'api-key', providerFamily: 'stripe', logoUrl: icon('stripe'), capabilities: ['payments', 'billing', 'revenue'] },
  { id: 'plaid', name: 'Plaid', category: 'Finance', description: 'Connect supported financial-account data through a provider adapter.', mode: 'api-key', providerFamily: 'plaid', logoUrl: icon('plaid'), capabilities: ['banking-data', 'transactions'] },
  { id: 'quickbooks', name: 'QuickBooks', category: 'Finance', description: 'Work with accounting, invoices, expenses, and business finances.', mode: 'oauth', providerFamily: 'quickbooks', logoUrl: icon('quickbooks'), capabilities: ['accounting', 'invoices', 'expenses'] },
  { id: 'openai-platform', aliases: ['openai'], name: 'OpenAI Platform', category: 'AI', description: 'Configure OpenAI API access for development and model workflows.', mode: 'api-key', providerFamily: 'openai', logoUrl: icon('openai'), capabilities: ['models', 'api', 'development'] },
  { id: 'jev', aliases: ['jev-ai'], name: 'Jev', category: 'AI routing', description: 'Optional MCP decision layer for same-family model routing. Phoenix keeps its native router whenever Jev is unavailable.', mode: 'mcp', providerFamily: 'jev', capabilities: ['model-routing', 'task-routing', 'completion-review'] },
  { id: 'codex', aliases: ['chatgpt'], name: 'Codex', category: 'Agents', description: 'Delegate coding and agent work to OpenAI Codex.', mode: 'native', providerFamily: 'openai', logoUrl: icon('openai'), capabilities: ['agents', 'code', 'delegation'] },
  { id: 'openclaw', name: 'OpenClaw', category: 'Agents', description: 'Connect the OpenClaw agent runtime and its local CLI tools.', mode: 'native', capabilities: ['agents', 'local-tools'] },
  { id: 'custom-mcp', name: 'Custom MCP Server', category: 'Automation', description: 'Attach any compatible stdio or Streamable HTTP MCP server to Phoenix.', mode: 'mcp', capabilities: ['dynamic-tools'] },
] as const

/** Domain presets shown above the connector catalog. */
export const CONNECTOR_PRESETS: readonly ConnectorPreset[] = [
  { id: 'default', name: 'Default', description: 'Balanced everyday Phoenix toolkit for research, files, communication, and development.', kind: 'native-preset', capabilities: ['agents', 'web', 'files', 'calendar', 'code'], recommendedConnectors: ['google-drive', 'google-calendar', 'github', 'notion'] },
  { id: 'development', name: 'Development', description: 'Coding, repositories, issues, deployment, databases, and cloud delivery.', kind: 'native-preset', capabilities: ['code', 'terminal', 'filesystem', 'lsp', 'deploy', 'database'], recommendedConnectors: ['github', 'linear', 'vercel', 'firebase', 'supabase', 'neon'] },
  { id: 'security', name: 'Security / Codex Security', description: 'Code review, dependency and secret scanning, hardening, and security workflows when the relevant tools are present.', kind: 'native-preset', capabilities: ['security-review', 'dependency-audit', 'secret-scan', 'hardening'], recommendedConnectors: ['github', 'sentry', 'cloudflare'] },
  { id: 'data-analytics', name: 'Data Analytics', description: 'Analyze tables, files, SQL sources, metrics, experiments, and charts.', kind: 'native-preset', capabilities: ['dataframes', 'charts', 'sql', 'statistics'], recommendedConnectors: ['posthog', 'bigquery', 'snowflake', 'supabase', 'neon'] },
  { id: 'cloud-data', name: 'Cloud & Data', description: 'Backends, databases, deployment, observability, and application data services.', kind: 'native-preset', capabilities: ['database', 'cloud', 'deploy', 'analytics'], recommendedConnectors: ['supabase', 'neon', 'firebase', 'vercel', 'posthog'] },
  { id: 'documents', name: 'Documents', description: 'Create, read, search, transform, and organize working documents.', kind: 'native-preset', capabilities: ['documents', 'files', 'knowledge'], recommendedConnectors: ['google-drive', 'onedrive', 'sharepoint', 'box', 'notion'] },
  { id: 'pdf', name: 'PDF', description: 'Read, analyze, assemble, and generate PDF deliverables when PDF tooling is installed.', kind: 'native-preset', capabilities: ['pdf.read', 'pdf.create'], recommendedConnectors: ['google-drive', 'onedrive', 'box'] },
  { id: 'presentations', name: 'Presentations', description: 'Build and refine presentation artifacts and publish them through connected design/file services.', kind: 'native-preset', capabilities: ['slides.create', 'slides.edit'], recommendedConnectors: ['canva', 'google-drive', 'onedrive'] },
  { id: 'meetings', name: 'Meetings & Collaboration', description: 'Coordinate calendars, chat, meetings, and team communication.', kind: 'native-preset', capabilities: ['calendar', 'messages', 'meetings'], recommendedConnectors: ['google-calendar', 'outlook-calendar', 'slack', 'microsoft-teams', 'zoom'] },
  { id: 'finance', name: 'Finance', description: 'Market, payment, banking-data, billing, and accounting workflows through connected read/write adapters.', kind: 'native-preset', capabilities: ['market-data', 'payments', 'transactions', 'accounting'], recommendedConnectors: ['binance', 'stripe', 'plaid', 'quickbooks'] },
  { id: 'research-ai', name: 'Research & AI', description: 'Research, model discovery, datasets, courses, and AI platform development.', kind: 'native-preset', capabilities: ['research', 'web', 'models', 'datasets'], recommendedConnectors: ['hugging-face', 'openai-platform', 'coursera'] },
  { id: 'ai-media', name: 'AI & Media', description: 'Model, design, image, video, voice, and presentation workflows.', kind: 'native-preset', capabilities: ['models', 'design', 'image', 'video', 'voice'], recommendedConnectors: ['hugging-face', 'canva', 'heygen', 'magnific'] },
] as const

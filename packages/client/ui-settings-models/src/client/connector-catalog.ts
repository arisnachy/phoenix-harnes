/** Secret-free catalog metadata for the Settings → Connectors hub. */

/** Configuration path a catalog connector expects once its adapter is installed. */
export type ConnectorMode = 'oauth' | 'api-key' | 'mcp' | 'native'

/** Provenance is explicit; a matching display name never grants vendor trust. */
export type ConnectorProvenance = 'vendor-official' | 'registry-listed' | 'private-owner' | 'native'

/** One discoverable external or local integration. */
export interface ConnectorDefinition {
  readonly id: string
  readonly aliases?: readonly string[]
  readonly name: string
  readonly category: string
  readonly description: string
  readonly mode: ConnectorMode
  readonly provenance: ConnectorProvenance
  readonly providerFamily?: string
  /** Exact authorization entry key when substring provider matching would be ambiguous. */
  readonly authorizationKey?: string
  /** Host-pinned MCP install route; browser input never carries the endpoint. */
  readonly curatedMcp?: true
  /** Existing OpenClaw skill-backed route Phoenix can verify and reuse. */
  readonly openClawConnectorId?: 'google-workspace' | 'github'
  /** Exact Official MCP Registry identity accepted for curated install, when one is verified. */
  readonly registryName?: string
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

/** Curated connector directory before explicit provenance is attached. */
const PUBLIC_CONNECTOR_CATALOG = [
  {
    id: 'google-workspace',
    aliases: ['gmail', 'google-calendar', 'calendar', 'google-drive', 'drive', 'google-contacts', 'contacts', 'google-docs', 'google-sheets', 'google-slides'],
    name: 'Google Workspace',
    category: 'Productivity',
    description: 'Gmail, Calendar, Drive, Contacts, Docs, Sheets, and Slides through one Google account.',
    mode: 'oauth',
    providerFamily: 'google-workspace',
    authorizationKey: 'authorization-google/account',
    openClawConnectorId: 'google-workspace',
    logoUrl: icon('google'),
    capabilities: ['mail.read', 'mail.write', 'calendar.read', 'calendar.write', 'files.read', 'files.write', 'contacts.read', 'documents', 'spreadsheets', 'presentations'],
  },
  { id: 'microsoft-learn', aliases: ['microsoft-docs-mcp', 'learn-mcp', 'docs-mcp'], name: 'Microsoft Learn (Docs)', category: 'Documentation', description: 'Official free read-only Microsoft Learn MCP. Public documentation for Microsoft 365, Azure, Windows, Graph and developer APIs; no access to private accounts and no OAuth.', mode: 'mcp', providerFamily: 'microsoft', curatedMcp: true, logoUrl: icon('microsoft'), capabilities: ['docs.search', 'docs.read', 'microsoft365.documentation', 'azure.documentation'] },
  { id: 'microsoft-personal', aliases: ['outlook-personal-mcp', 'microsoft-graph-personal'], name: 'Microsoft Personal (Outlook, Calendar, OneDrive)', category: 'Productivity', description: 'Servidor local para Microsoft Graph delegado; requiere configurar una aplicación pública Microsoft Entra y autorizar la cuenta personal. No es Microsoft 365 de pago.', mode: 'mcp', providerFamily: 'microsoft', curatedMcp: true, logoUrl: icon('microsoft'), capabilities: ['mail.read', 'mail.write', 'calendar.read', 'contacts.read', 'files.read'] },
  { id: 'microsoft-workiq', aliases: ['microsoft365-mcp', 'm365-suite', 'workiq'], name: 'Microsoft 365 Work IQ', category: 'Productivity', description: 'Official Microsoft 365 context MCP for Outlook email, calendar, OneDrive, SharePoint, documents and Teams. REQUIRES billed Work IQ usage, Microsoft Entra admin consent and acceptance of its EULA. Not free.', mode: 'mcp', providerFamily: 'microsoft', curatedMcp: true, logoUrl: icon('microsoft365'), capabilities: ['m365.search', 'mail.read', 'calendar.read', 'onedrive.search', 'sharepoint.search', 'teams.search'] },
  { id: 'microsoft-azure', aliases: ['azure-mcp', 'azure-cloud'], name: 'Microsoft Azure MCP', category: 'Cloud', description: 'Official local Azure MCP server using consolidated tools and Azure CLI authentication. MCP package is free, but Azure resources and operations can incur charges.', mode: 'mcp', providerFamily: 'microsoft', curatedMcp: true, logoUrl: icon('microsoftazure'), capabilities: ['azure.resources', 'azure.databases', 'azure.storage', 'azure.operations-with-approval'] },
  { id: 'outlook-mail', aliases: ['microsoft-mail-graph'], name: 'Outlook · correo', category: 'Email', description: 'Conector Graph separado: leer mensajes, crear borradores y enviar con permiso. OAuth device-code y permisos exclusivos de correo. Instalar no autoriza la cuenta.', mode: 'mcp', providerFamily: 'microsoft', curatedMcp: true, logoUrl: icon('microsoftoutlook'), capabilities: ['mail.read', 'mail.write'] },
  { id: 'outlook-calendar', aliases: ['microsoft-calendar-graph'], name: 'Outlook · calendario', category: 'Calendar', description: 'Conector Graph independiente para consultar eventos y crear citas; consentimiento de calendario separado del correo.', mode: 'mcp', providerFamily: 'microsoft', curatedMcp: true, logoUrl: icon('microsoftoutlook'), capabilities: ['calendar.read', 'calendar.write'] },
  { id: 'microsoft-contacts', name: 'Microsoft · contactos', category: 'Contacts', description: 'Conector Graph independiente de solo lectura para los contactos con Contacts.Read.', mode: 'mcp', providerFamily: 'microsoft', curatedMcp: true, logoUrl: icon('microsoft'), capabilities: ['contacts.read'] },
  { id: 'onedrive', name: 'OneDrive · archivos', category: 'Files', description: 'Conector Graph independiente para listar archivos y carpetas OneDrive. Solo lectura; no afirma edición ni escritura.', mode: 'mcp', providerFamily: 'microsoft', curatedMcp: true, logoUrl: icon('microsoftonedrive'), capabilities: ['files.read'] },
  { id: 'sharepoint', name: 'SharePoint · sitios', category: 'Knowledge', description: 'Conector Graph empresarial separado para buscar sitios y bibliotecas. Requiere cuenta de organización y Sites.Read.All; sujeto a políticas de Entra.', mode: 'mcp', providerFamily: 'microsoft', curatedMcp: true, logoUrl: icon('microsoftsharepoint'), capabilities: ['sites.read', 'documents.list'] },
  { id: 'box', name: 'Box', category: 'Files', description: 'Search and work with Box documents and folders.', mode: 'oauth', providerFamily: 'box', logoUrl: icon('box'), capabilities: ['files.read', 'files.write'] },
  { id: 'dropbox', name: 'Dropbox', category: 'Files', description: 'Search and work with Dropbox files and folders.', mode: 'oauth', providerFamily: 'dropbox', logoUrl: icon('dropbox'), capabilities: ['files.read', 'files.write'] },
  { id: 'notion', aliases: ['notion-mcp'], registryName: 'com.notion/mcp', name: 'Notion', category: 'Knowledge', description: 'Official Notion remote MCP for pages, databases, search, and workspace knowledge with user-scoped OAuth.', mode: 'mcp', providerFamily: 'notion', curatedMcp: true, logoUrl: icon('notion'), capabilities: ['knowledge.read', 'knowledge.write'] },
  { id: 'x', aliases: ['twitter', 'x-api'], name: 'X · cuenta de usuario', category: 'Social', description: 'MCP oficial de X con puente xurl y OAuth propio de la cuenta autorizada. Requiere una aplicación X de desarrollador, CLIENT_ID/CLIENT_SECRET y completar el consentimiento una vez. Instalable directamente sin consultar el registro MCP; instalar no equivale a iniciar sesión.', mode: 'mcp', providerFamily: 'x', curatedMcp: true, logoUrl: icon('x'), capabilities: ['posts', 'search', 'users', 'bookmarks', 'news', 'trends', 'articles'] },
  { id: 'x-docs', aliases: ['x-developer-docs'], name: 'X · documentación gratuita', category: 'Documentation', description: 'MCP oficial público de documentación X, separado del acceso a cuentas y de cualquier permiso para publicar.', mode: 'mcp', providerFamily: 'x-docs', curatedMcp: true, logoUrl: icon('x'), capabilities: ['docs.search', 'docs.read'] },
  { id: 'social-engine', aliases: ['phoenix-social', 'kira-social'], name: 'Phoenix Social Engine · cuentas propias', category: 'Social', description: 'Herramientas locales para que Kira prepare perfiles de Phoenix IA, planifique el registro oficial, cree campañas y borradores, y compruebe qué cuentas han sido verificadas. No crea perfiles externos ni inicia sesión por sí sola: el alta exige consentimiento y verificaciones oficiales.', mode: 'mcp', providerFamily: 'phoenix-social', curatedMcp: true, capabilities: ['social.brand', 'social.accounts', 'social.campaigns', 'social.drafts', 'social.publication'] },
  { id: 'meta-publishing', aliases: ['meta-graph-publishing', 'facebook-pages-publisher', 'instagram-professional-publisher'], name: 'Meta Graph Publishing · Facebook + Instagram', category: 'Social', description: 'Conector local para publicar mediante Meta Graph API con permisos de Páginas Facebook e Instagram Professional. Requiere cuenta verificada y tokens obtenidos oficialmente; solicita los identificadores y tokens mediante el vault protegido de Phoenix, no por el chat. No equivale a Meta DevTools.', mode: 'mcp', providerFamily: 'meta-graph', curatedMcp: true, logoUrl: icon('meta'), capabilities: ['facebook.pages.publish', 'instagram.professional.publish', 'social.accounts.verify', 'social.campaigns'] },
  { id: 'meta-devtools', aliases: ['meta-developer-tools', 'meta-social-technologies', 'facebook-devtools'], name: 'Meta Social Technologies (DevTools)', category: 'Social', description: 'Official Meta Developer Tools MCP for app health, API usage, App Review, permissions and webhooks. It does not publish Facebook or Instagram posts.', mode: 'mcp', providerFamily: 'meta', curatedMcp: true, logoUrl: icon('meta'), capabilities: ['meta.apps.read', 'meta.api-health', 'meta.app-review', 'meta.webhooks.read', 'meta.webhooks.manage-with-approval'] },
  { id: 'meta-whatsapp-business', aliases: ['whatsapp-business-tools', 'whatsapp-cloud-api'], name: 'WhatsApp Business Tools (Meta)', category: 'Communication', description: 'Official hosted Meta MCP for WhatsApp Business Cloud API accounts, templates, phone numbers and webhooks. Messages can cost money; require explicit confirmation before sending.', mode: 'mcp', providerFamily: 'meta', curatedMcp: true, logoUrl: icon('whatsapp'), capabilities: ['whatsapp.businesses.read', 'whatsapp.accounts.read', 'whatsapp.templates.manage', 'whatsapp.webhooks.manage', 'whatsapp.messages.send-with-approval'] },
  { id: 'slack', aliases: ['slack-mcp'], name: 'Slack', category: 'Communication', description: 'Official Slack MCP for channels, search, messages, and collaboration. Slack requires a registered Slack OAuth client for custom harnesses.', mode: 'mcp', providerFamily: 'slack', curatedMcp: true, logoUrl: icon('slack'), capabilities: ['messages.read', 'messages.write'] },
  { id: 'telegram', aliases: ['telegram-bot', 'botfather', 'kira-telegram'], name: 'Telegram · Kira', category: 'Communication', description: 'Configura y verifica un bot propio de Telegram con BotFather. Token protegido en las credenciales de Phoenix. La mensajería y las llamadas se habilitarán cuando exista el receptor autorizado.', mode: 'api-key', providerFamily: 'telegram', logoUrl: icon('telegram'), capabilities: ['bot.setup', 'bot.verify'] },
  { id: 'microsoft-teams', aliases: ['teams'], name: 'Microsoft Teams · canales', category: 'Communication', description: 'Conector Graph empresarial para leer equipos, canales y mensajes. No incluye chat privado, llamadas ni escritura; requiere permisos delegados y posible consentimiento administrativo.', mode: 'mcp', providerFamily: 'microsoft', curatedMcp: true, logoUrl: icon('microsoftteams'), capabilities: ['teams.read', 'channels.read', 'messages.read'] },
  { id: 'zoom', name: 'Zoom', category: 'Meetings', description: 'Manage meetings, recordings, and meeting metadata.', mode: 'oauth', providerFamily: 'zoom', logoUrl: icon('zoom'), capabilities: ['meetings.read', 'meetings.write'] },
  {
    id: 'github',
    registryName: 'io.github.github/github-mcp-server',
    curatedMcp: true,
    name: 'GitHub',
    category: 'Development',
    description: "Repositories, commits, issues, pull requests, releases, and CI via a verified GitHub CLI session or GitHub's official remote MCP with dedicated repository OAuth; GitHub Copilot model authentication is separate.",
    mode: 'mcp',
    authorizationKey: 'authorization-openclaw/github',
    openClawConnectorId: 'github',
    logoUrl: icon('github'),
    capabilities: ['code.read', 'code.write', 'issues', 'pull-requests', 'ci'],
  },
  { id: 'linear', aliases: ['linear-mcp'], name: 'Linear', category: 'Development', description: 'Official Linear remote MCP for issues, projects, initiatives, and product workflows with OAuth.', mode: 'mcp', providerFamily: 'linear', curatedMcp: true, logoUrl: icon('linear'), capabilities: ['issues', 'projects'] },
  { id: 'jira', name: 'Jira', category: 'Development', description: 'Work with issues, projects, boards, and engineering workflows.', mode: 'oauth', providerFamily: 'jira', logoUrl: icon('jira'), capabilities: ['issues', 'projects'] },
  { id: 'vercel', name: 'Vercel', category: 'Deploy', description: 'Official Vercel hosted MCP for projects, deployment logs, and deploy workflows using browser OAuth.', mode: 'mcp', providerFamily: 'vercel', curatedMcp: true, logoUrl: icon('vercel'), capabilities: ['deployments', 'hosting'] },
  { id: 'firebase', name: 'Firebase', category: 'Cloud', description: 'Work with Firebase projects, hosting, databases, auth, and functions.', mode: 'oauth', providerFamily: 'firebase', logoUrl: icon('firebase'), capabilities: ['database', 'auth', 'hosting', 'functions'] },
  { id: 'supabase', aliases: ['supabase-mcp'], registryName: 'com.supabase/mcp', name: 'Supabase', category: 'Database', description: 'Official hosted Supabase MCP for Postgres, Auth, Storage, Realtime, and Edge Functions with browser OAuth.', mode: 'mcp', providerFamily: 'supabase', curatedMcp: true, logoUrl: icon('supabase'), capabilities: ['database', 'auth', 'storage', 'functions'] },
  { id: 'neon', name: 'Neon', category: 'Database', description: 'Manage serverless PostgreSQL projects, branches, and computes.', mode: 'mcp', providerFamily: 'neon', logoUrl: icon('neon'), capabilities: ['database', 'postgres'] },
  { id: 'mongodb', name: 'MongoDB', category: 'Database', description: 'Inspect and operate MongoDB databases and Atlas resources.', mode: 'mcp', providerFamily: 'mongodb', logoUrl: icon('mongodb'), capabilities: ['database'] },
  { id: 'snowflake', name: 'Snowflake', category: 'Data', description: 'Query warehouses and analyze governed enterprise data.', mode: 'mcp', providerFamily: 'snowflake', logoUrl: icon('snowflake'), capabilities: ['sql', 'analytics'] },
  { id: 'bigquery', name: 'BigQuery', category: 'Data', description: 'Query and analyze Google Cloud data warehouses.', mode: 'oauth', providerFamily: 'bigquery', logoUrl: icon('googlebigquery'), capabilities: ['sql', 'analytics'] },
  { id: 'posthog', registryName: 'io.github.PostHog/mcp', name: 'PostHog', category: 'Analytics', description: 'Use product analytics, funnels, experiments, flags, logs, and surveys.', mode: 'mcp', providerFamily: 'posthog', logoUrl: icon('posthog'), capabilities: ['analytics', 'experiments', 'feature-flags'] },
  { id: 'sentry', registryName: 'io.github.getsentry/sentry-mcp', name: 'Sentry', category: 'Observability', description: 'Inspect application errors, traces, releases, and performance.', mode: 'mcp', providerFamily: 'sentry', logoUrl: icon('sentry'), capabilities: ['errors', 'traces', 'observability'] },
  { id: 'cloudflare', aliases: ['cloudflare-mcp'], name: 'Cloudflare', category: 'Cloud', description: 'Official Cloudflare API MCP for Workers, DNS, domains, deployments, and edge services with OAuth.', mode: 'mcp', providerFamily: 'cloudflare', curatedMcp: true, logoUrl: icon('cloudflare'), capabilities: ['edge', 'dns', 'deployments'] },
  { id: 'hugging-face', aliases: ['huggingface'], name: 'Hugging Face', category: 'AI', description: 'Inspect models, datasets, Spaces, and research artifacts.', mode: 'api-key', providerFamily: 'hugging-face', logoUrl: icon('huggingface'), capabilities: ['models', 'datasets', 'research'] },
  { id: 'canva', aliases: ['canvas', 'canva-mcp'], registryName: 'com.canva.mcp/mcp', name: 'Canva', category: 'Design', description: 'Create, refine, resize, and review visual designs, presentation assets, thumbnails, and video-ready media through Canva\'s official remote MCP.', mode: 'mcp', providerFamily: 'canva', curatedMcp: true, logoUrl: icon('canva'), capabilities: ['design', 'presentations', 'thumbnails', 'media-assets', 'video-assets'] },
  { id: 'figma', aliases: ['figma-mcp', 'figma-desktop'], registryName: 'com.figma.mcp/mcp', name: 'Figma', category: 'Design', description: 'Figma remote MCP uses browser OAuth; Figma Desktop MCP uses http://127.0.0.1:3845/mcp with Dev Mode enabled and needs no OAuth. Choose the appropriate setup for your installed Figma server.', mode: 'mcp', providerFamily: 'figma', curatedMcp: true, logoUrl: icon('figma'), capabilities: ['design', 'ui'] },
  { id: 'heygen', aliases: ['heygen-mcp'], name: 'HeyGen', category: 'Video AI', description: 'Official HeyGen remote MCP for video, avatars, voice-over, translation, and media workflows with OAuth.', mode: 'mcp', providerFamily: 'heygen', curatedMcp: true, logoUrl: icon('heygen'), capabilities: ['video', 'voice', 'avatars', 'voice-over', 'translation'] },
  { id: 'magnific', name: 'Magnific', category: 'Multimedia', description: 'Generate, enhance, upscale, relight, and transform visual media.', mode: 'api-key', providerFamily: 'magnific', capabilities: ['image', 'video', 'upscale'] },
  { id: 'coursera', name: 'Coursera', category: 'Education', description: 'Find learning content and relevant lecture videos.', mode: 'oauth', providerFamily: 'coursera', logoUrl: icon('coursera'), capabilities: ['learning', 'courses'] },
  { id: 'devpost', aliases: ['devpost-hackathons'], name: 'Devpost Hackathons', category: 'Development', description: 'Official Devpost MCP for discovery, registration, rules, dates, judging criteria, project assets, submission, and live verification.', mode: 'mcp', providerFamily: 'devpost', curatedMcp: true, logoUrl: icon('devpost'), capabilities: ['hackathons', 'registration', 'rules', 'dates', 'announcements', 'prizes', 'judging', 'requirements', 'projects', 'thumbnails', 'submissions', 'submission-verification'] },
  { id: 'brave-search', aliases: ['brave', 'brave-mcp'], name: 'Brave Search', category: 'Web', description: 'Official Brave Search MCP for web, local, image, news, and video search. Uses BRAVE_API_KEY from the Phoenix credential vault.', mode: 'mcp', providerFamily: 'brave', curatedMcp: true, logoUrl: icon('brave'), capabilities: ['web-search', 'local-search', 'images', 'news', 'video'] },
  { id: 'filesystem', aliases: ['filesystem-mcp', 'files-mcp'], name: 'Filesystem MCP', category: 'Files', description: 'Official Model Context Protocol filesystem server, constrained by Phoenix to the active workspace root.', mode: 'mcp', providerFamily: 'model-context-protocol', curatedMcp: true, logoUrl: icon('modelcontextprotocol'), capabilities: ['files.read', 'files.write', 'filesystem'] },
  { id: 'memory', aliases: ['memory-mcp'], name: 'Memory MCP', category: 'Knowledge', description: 'Official Model Context Protocol local knowledge-graph memory server for durable entity and relation memory.', mode: 'mcp', providerFamily: 'model-context-protocol', curatedMcp: true, logoUrl: icon('modelcontextprotocol'), capabilities: ['memory', 'knowledge-graph'] },
  { id: 'fetch', aliases: ['fetch-mcp'], name: 'Fetch MCP', category: 'Web', description: 'Official Model Context Protocol Fetch server for controlled web content retrieval. Network access remains subject to Phoenix policy.', mode: 'mcp', providerFamily: 'model-context-protocol', curatedMcp: true, logoUrl: icon('modelcontextprotocol'), capabilities: ['fetch', 'web.read'] },
  { id: 'apollo', aliases: ['apollo-io'], name: 'Apollo.io', category: 'Sales', description: 'Search, enrich, and qualify accounts and contacts for outbound work.', mode: 'api-key', providerFamily: 'apollo', capabilities: ['sales', 'prospecting', 'enrichment'] },
  { id: 'salesforce', name: 'Salesforce', category: 'CRM', description: 'Work with CRM accounts, contacts, opportunities, and workflows.', mode: 'oauth', providerFamily: 'salesforce', logoUrl: icon('salesforce'), capabilities: ['crm', 'sales'] },
  { id: 'hubspot', name: 'HubSpot', category: 'CRM', description: 'Work with CRM records, marketing, sales, and service workflows.', mode: 'oauth', providerFamily: 'hubspot', logoUrl: icon('hubspot'), capabilities: ['crm', 'marketing', 'sales'] },
  { id: 'twilio', name: 'Twilio', category: 'Communication', description: 'Send messages and integrate programmable communications.', mode: 'api-key', providerFamily: 'twilio', logoUrl: icon('twilio'), capabilities: ['sms', 'communications'] },
  { id: 'binance', aliases: ['binance-agent-os'], name: 'Binance', category: 'Finance', description: 'On-demand crypto workspace: PAPER needs no account; connect Spot Testnet with vault-stored HMAC keys or install Binance Agent OS and complete Binance OAuth for REAL. No orders until separately authorized.', mode: 'mcp', providerFamily: 'binance', logoUrl: icon('binance'), capabilities: ['markets', 'crypto', 'price-data', 'paper-trading', 'strategy-learning', 'agent-os', 'real-trading-with-confirmation'] },
  { id: 'stripe', name: 'Stripe', category: 'Finance', description: 'Inspect payments, customers, subscriptions, invoices, and revenue data.', mode: 'api-key', providerFamily: 'stripe', logoUrl: icon('stripe'), capabilities: ['payments', 'billing', 'revenue'] },
  { id: 'plaid', name: 'Plaid', category: 'Finance', description: 'Connect supported financial-account data through a provider adapter.', mode: 'api-key', providerFamily: 'plaid', logoUrl: icon('plaid'), capabilities: ['banking-data', 'transactions'] },
  { id: 'quickbooks', name: 'QuickBooks', category: 'Finance', description: 'Work with accounting, invoices, expenses, and business finances.', mode: 'oauth', providerFamily: 'quickbooks', logoUrl: icon('quickbooks'), capabilities: ['accounting', 'invoices', 'expenses'] },
  { id: 'openai-platform', aliases: ['openai'], name: 'OpenAI Platform', category: 'AI', description: 'Configure OpenAI API access for development and model workflows.', mode: 'api-key', providerFamily: 'openai', logoUrl: icon('openai'), capabilities: ['models', 'api', 'development'] },
  { id: 'codex', aliases: ['chatgpt', 'openai-codex'], name: 'OpenAI Codex', category: 'Agents', description: 'Use the native ChatGPT/Codex account session for models, coding, agents, and realtime voice without an API key.', mode: 'oauth', providerFamily: 'codex', logoUrl: icon('openai'), capabilities: ['models', 'agents', 'code', 'delegation', 'voice'] },
] as const

/** Curated connector directory. Runtime state is joined separately from authorization/MCP telemetry. */
export const CONNECTOR_CATALOG: readonly ConnectorDefinition[] = [
  ...PUBLIC_CONNECTOR_CATALOG.map(definition => ({ ...definition, provenance: 'vendor-official' as const })),
  {
    id: 'evolucionrd',
    aliases: ['evolucion-rd'],
    name: 'EvolucionRD',
    category: 'Private',
    description: 'Owner-private EvolucionRD connector.',
    mode: 'native',
    provenance: 'private-owner',
    providerFamily: 'evolucionrd',
    capabilities: ['private-tools'],
  },
  {
    id: 'kira-juancito-secure',
    aliases: ['kira-juancito', 'juancito'],
    name: 'KIRA Juancito Secure',
    category: 'Private',
    description: 'Owner-private authenticated Juancito inventory connector.',
    mode: 'native',
    provenance: 'private-owner',
    providerFamily: 'kira-juancito-secure',
    capabilities: ['private-tools'],
  },
  {
    id: 'openclaw',
    name: 'OpenClaw',
    category: 'Agents',
    description: 'Connect the OpenClaw agent runtime and its local CLI tools.',
    mode: 'native',
    provenance: 'native',
    capabilities: ['agents', 'local-tools'],
  },
  {
    id: 'custom-mcp',
    name: 'Custom MCP Server',
    category: 'Automation',
    description: 'Attach a compatible MCP server explicitly; registry listing does not imply vendor ownership.',
    mode: 'mcp',
    provenance: 'registry-listed',
    capabilities: ['dynamic-tools'],
  },
]

/** Domain presets shown above the connector catalog. */
export const CONNECTOR_PRESETS: readonly ConnectorPreset[] = [
  { id: 'hackathon', name: 'Hackathon', description: 'End-to-end competition kit: official event data, code, deployment, visual assets, demo video, narration, evidence, and verified submission.', kind: 'native-preset', capabilities: ['hackathons', 'planning', 'code', 'qa', 'deploy', 'evidence', 'video', 'voice', 'submission'], recommendedConnectors: ['devpost', 'github', 'vercel', 'canva', 'heygen', 'google-workspace', 'posthog', 'sentry'] },
  { id: 'default', name: 'Default', description: 'Balanced everyday Phoenix toolkit for research, files, communication, and development.', kind: 'native-preset', capabilities: ['agents', 'web', 'files', 'calendar', 'code'], recommendedConnectors: ['google-workspace', 'github', 'notion'] },
  { id: 'development', name: 'Development', description: 'Coding, repositories, issues, deployment, databases, and cloud delivery.', kind: 'native-preset', capabilities: ['code', 'terminal', 'filesystem', 'lsp', 'deploy', 'database'], recommendedConnectors: ['github', 'linear', 'vercel', 'firebase', 'supabase', 'neon'] },
  { id: 'security', name: 'Security / Codex Security', description: 'Code review, dependency and secret scanning, hardening, and security workflows when the relevant tools are present.', kind: 'native-preset', capabilities: ['security-review', 'dependency-audit', 'secret-scan', 'hardening'], recommendedConnectors: ['github', 'sentry', 'cloudflare'] },
  { id: 'data-analytics', name: 'Data Analytics', description: 'Analyze tables, files, SQL sources, metrics, experiments, and charts.', kind: 'native-preset', capabilities: ['dataframes', 'charts', 'sql', 'statistics'], recommendedConnectors: ['posthog', 'bigquery', 'snowflake', 'supabase', 'neon'] },
  { id: 'cloud-data', name: 'Cloud & Data', description: 'Backends, databases, deployment, observability, and application data services.', kind: 'native-preset', capabilities: ['database', 'cloud', 'deploy', 'analytics'], recommendedConnectors: ['supabase', 'neon', 'firebase', 'vercel', 'posthog'] },
  { id: 'documents', name: 'Documents', description: 'Create, read, search, transform, and organize working documents.', kind: 'native-preset', capabilities: ['documents', 'files', 'knowledge'], recommendedConnectors: ['google-workspace', 'onedrive', 'sharepoint', 'box', 'notion'] },
  { id: 'pdf', name: 'PDF', description: 'Read, analyze, assemble, and generate PDF deliverables when PDF tooling is installed.', kind: 'native-preset', capabilities: ['pdf.read', 'pdf.create'], recommendedConnectors: ['google-workspace', 'onedrive', 'box'] },
  { id: 'presentations', name: 'Presentations', description: 'Build and refine presentation artifacts and publish them through connected design/file services.', kind: 'native-preset', capabilities: ['slides.create', 'slides.edit'], recommendedConnectors: ['canva', 'google-workspace', 'onedrive'] },
  { id: 'meetings', name: 'Meetings & Collaboration', description: 'Coordinate calendars, chat, meetings, and team communication.', kind: 'native-preset', capabilities: ['calendar', 'messages', 'meetings'], recommendedConnectors: ['google-workspace', 'outlook-calendar', 'slack', 'microsoft-teams', 'zoom'] },
  { id: 'finance', name: 'Finance', description: 'Market, payment, banking-data, billing, and accounting workflows through connected read/write adapters.', kind: 'native-preset', capabilities: ['market-data', 'payments', 'transactions', 'accounting'], recommendedConnectors: ['binance', 'stripe', 'plaid', 'quickbooks'] },
  { id: 'research-ai', name: 'Research & AI', description: 'Research, model discovery, datasets, courses, and AI platform development.', kind: 'native-preset', capabilities: ['research', 'web', 'models', 'datasets'], recommendedConnectors: ['hugging-face', 'openai-platform', 'coursera'] },
  { id: 'ai-media', name: 'AI & Media', description: 'Model, design, image, video, voice, and presentation workflows.', kind: 'native-preset', capabilities: ['models', 'design', 'image', 'video', 'voice'], recommendedConnectors: ['hugging-face', 'canva', 'heygen', 'magnific'] },
] as const

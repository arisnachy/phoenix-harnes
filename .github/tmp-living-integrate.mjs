import fs from 'node:fs'

function replaceOnce(path, needle, replacement, already) {
  let text = fs.readFileSync(path, 'utf8')
  if (already !== undefined && text.includes(already)) return
  if (!text.includes(needle)) throw new Error(`${path}: expected insertion point not found`)
  text = text.replace(needle, replacement)
  fs.writeFileSync(path, text)
}

const patchPath = 'packages/bundle/base/cordis.patch.yml'
replaceOnce(
  patchPath,
  "    - id: jobs\n      name: '@phoenix-ai/dsh-jobs-local'\n\n",
  "    - id: jobs\n      name: '@phoenix-ai/dsh-jobs-local'\n\n    - id: living-local\n      name: '@phoenix-ai/dsh-living-local'\n      config:\n        path: !!js dshHomePath('memory', 'living-creations.json')\n\n    - id: tool-living\n      name: '@phoenix-ai/dsh-tool-living'\n\n",
  'id: living-local',
)

const pkgPath = 'packages/bundle/base/package.json'
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
for (const dependency of [
  '@phoenix-ai/dsh-living',
  '@phoenix-ai/dsh-living-local',
  '@phoenix-ai/dsh-tool-living',
]) pkg.dependencies[dependency] = 'workspace:^'
fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)

replaceOnce(
  'tsconfig.host.json',
  '    { "path": "./packages/core/tools" },\n',
  '    { "path": "./packages/core/tools" },\n    { "path": "./packages/core/living" },\n    { "path": "./packages/core/living-local" },\n    { "path": "./packages/core/tool-living" },\n',
  './packages/core/living',
)

const catalog = 'scripts/gen-cordis-catalog.ts'
replaceOnce(
  catalog,
  "  llm: 'llm-streaming.md',\n",
  "  llm: 'llm-streaming.md',\n  living: 'living.md',\n",
  "living: 'living.md'",
)
replaceOnce(
  catalog,
  "  LspQueryResult: 'lsp.md',\n",
  "  LspQueryResult: 'lsp.md',\n  LivingChangedListener: 'living.md',\n  LivingCreationEvent: 'living.md',\n  LivingCreationEventListener: 'living.md',\n  LivingCreationId: 'living.md',\n  LivingCreationManifest: 'living.md',\n  LivingCreationProvider: 'living.md',\n  LivingCreationSnapshot: 'living.md',\n  LivingIntegrationLevel: 'living.md',\n  LivingJson: 'living.md',\n  LivingState: 'living.md',\n",
  "LivingCreationManifest: 'living.md'",
)

replaceOnce(
  'scripts/gen-doc-graphs.ts',
  "  {\n    key: 'web',\n    pkg: 'web',\n",
  "  {\n    key: 'living',\n    pkg: 'living',\n    title: 'Universal living creation registry',\n    mode: 'seam',\n    implementations: ['living-local'],\n    consumers: ['tool-living'],\n    note: 'Keeps arbitrary Phoenix-created artifacts and systems durably identified while live providers expose their self-described state, events, actions, resources, and actors without coupling the core to a closed creation taxonomy.',\n  },\n  {\n    key: 'web',\n    pkg: 'web',\n",
  "key: 'living',\n    pkg: 'living',",
)

const toolCatalog = 'scripts/gen-tool-catalog.ts'
replaceOnce(
  toolCatalog,
  "import LocalJobRegistry from '@phoenix-ai/dsh-jobs-local'\n",
  "import LocalJobRegistry from '@phoenix-ai/dsh-jobs-local'\nimport LocalLivingRegistry from '@phoenix-ai/dsh-living-local'\nimport * as ToolLiving from '@phoenix-ai/dsh-tool-living'\n",
  "import * as ToolLiving from '@phoenix-ai/dsh-tool-living'",
)
replaceOnce(
  toolCatalog,
  "  {\n    pkg: '@phoenix-ai/dsh-tool-lsp',\n",
  "  {\n    pkg: '@phoenix-ai/dsh-tool-living',\n    dir: 'tool-living',\n    source: 'packages/core/tool-living/src/index.ts',\n    requires: ['ctx.tools', 'ctx.living', 'ctx.systemPrompt'],\n    writes: ['tool/call', 'durable living creation manifest', 'live creation state/actions/events through ctx.living', 'tool/result'],\n    async mount(ctx) {\n      const catalogPath = resolve(root, '.tmp', 'tool-catalog-living.json')\n      await ctx.plugin(LocalLivingRegistry, { path: catalogPath })\n      await ctx.plugin(ToolLiving)\n    },\n    note:\n      'Universal domain-neutral control surface: arbitrary future creation kinds describe their own state, actions, events, resources, actors, and target integration level; verification refuses delivery below that target.',\n  },\n  {\n    pkg: '@phoenix-ai/dsh-tool-lsp',\n",
  "pkg: '@phoenix-ai/dsh-tool-living'",
)

const architecture = 'docs/architecture.md'
replaceOnce(
  architecture,
  '| [`core/tools`](subsystems/tools.md) | The scoped tool registry and guarded execution pipeline | `ctx.tools` |\n',
  '| [`core/tools`](subsystems/tools.md) | The scoped tool registry and guarded execution pipeline | `ctx.tools` |\n| [`core/living`](subsystems/living.md) | Durable identity and operational connection for everything Phoenix creates | `ctx.living` |\n',
  '| [`core/living`](subsystems/living.md)',
)
replaceOnce(
  architecture,
  '| Add a model-facing capability | register on `ctx.tools`; its schema joins prompt assembly |\n',
  '| Add a model-facing capability | register on `ctx.tools`; its schema joins prompt assembly |\n| Keep a Phoenix-created artifact or system operationally connected | register its self-described manifest on `ctx.living`; attach a provider or adapter for the strongest meaningful live level |\n',
  '| Keep a Phoenix-created artifact or system operationally connected |',
)

import fs from 'node:fs'

const patchPath = 'packages/bundle/base/cordis.patch.yml'
let patch = fs.readFileSync(patchPath, 'utf8')
if (!patch.includes('id: living-local')) {
  const needle = "    - id: jobs\n      name: '@phoenix-ai/dsh-jobs-local'\n\n"
  const insert = `${needle}    - id: living-local\n      name: '@phoenix-ai/dsh-living-local'\n      config:\n        path: !!js dshHomePath('memory', 'living-creations.json')\n\n    - id: tool-living\n      name: '@phoenix-ai/dsh-tool-living'\n\n`
  if (!patch.includes(needle)) throw new Error('base jobs row not found')
  fs.writeFileSync(patchPath, patch.replace(needle, insert))
}

const pkgPath = 'packages/bundle/base/package.json'
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
for (const dependency of [
  '@phoenix-ai/dsh-living',
  '@phoenix-ai/dsh-living-local',
  '@phoenix-ai/dsh-tool-living',
]) pkg.dependencies[dependency] = 'workspace:^'
fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)

const tsPath = 'tsconfig.host.json'
let ts = fs.readFileSync(tsPath, 'utf8')
if (!ts.includes('./packages/core/living')) {
  const needle = '    { "path": "./packages/core/tools" },\n'
  const insert = `${needle}    { "path": "./packages/core/living" },\n    { "path": "./packages/core/living-local" },\n    { "path": "./packages/core/tool-living" },\n`
  if (!ts.includes(needle)) throw new Error('host tools project reference not found')
  fs.writeFileSync(tsPath, ts.replace(needle, insert))
}

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const workflows = [
  fileURLToPath(new URL('../.github/workflows/phoenix-upstream-quarantine.yml', import.meta.url)),
  fileURLToPath(new URL('../.github/workflows/phoenix-evolution-watch.yml', import.meta.url)),
]

for (const path of workflows) {
  const workflow = readFileSync(path, 'utf8')

  test(`${basename(path)} requires an independent DeepSeek source`, () => {
    assert.doesNotMatch(
      workflow,
      /(?:git remote add deepseek(?:-upstream)?|git ls-remote)\s+https:\/\/github\.com\/arisnachy\/phoenix-harnes\.git/,
    )
    assert.doesNotMatch(workflow, /arisnachy\/phoenix-harnes/i)
    assert.match(workflow, /DEEPSEEK_UPSTREAM_REPOSITORY:\s*\$\{\{\s*vars\.DEEPSEEK_UPSTREAM_REPOSITORY\s*\}\}/)
    assert.match(workflow, /DEEPSEEK_UPSTREAM_REPOSITORY is not configured/)
    assert.match(workflow, /configured upstream resolves to the PHOENIX repository/)
    assert.match(workflow, /configured_identity[\s\S]{0,320}phoenix_identity/)
    assert.match(workflow, /(?:git remote add deepseek(?:-upstream)?|git ls-remote)\s+"\$source"/)
  })
}

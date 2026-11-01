import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
const repair = readFileSync(new URL('../.github/workflows/phoenix-ci-repair-assistant.yml', import.meta.url), 'utf8')

test('CI runs its existing gates on pull requests and pushes to both protected branches', () => {
  assert.match(ci, /^on:\n  pull_request:\n  push:\n    branches: \[main, stable\]/mu)
  assert.doesNotMatch(ci, /^\s+if: github\.event_name == 'pull_request'/mu,
    'required jobs must not be silently skipped on main and stable pushes')
  assert.match(ci, /^    if: always\(\)$/mu,
    'the aggregate success/failure gate must evaluate on every configured event')
  assert.match(ci, /DSH_ARCHIVE_BASE_REF: \$\{\{ github\.event\.pull_request\.base\.sha \|\| github\.event\.before \}\}/u)
})

test('repair automation only checks out trusted main and proposes a pull request', () => {
  assert.match(repair, /^  workflow_dispatch:$/mu)
  assert.match(repair, /^  workflow_run:$/mu)
  assert.match(repair, /github\.event\.workflow_run\.event == 'push'/u)
  assert.match(repair, /github\.event\.workflow_run\.conclusion == 'failure'/u)
  assert.match(repair, /^          ref: main$/mu)
  assert.match(repair, /peter-evans\/create-pull-request@v7/u)
  assert.doesNotMatch(repair, /^\s+run:\s*(?:git push|gh pr merge)/mu,
    'repair bot must not directly publish or merge protected branches')
})

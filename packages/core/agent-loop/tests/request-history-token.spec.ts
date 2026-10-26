import { describe, expect, it } from 'vitest'
import { createUserMessage } from '@phoenix-ai/dsh-llm'
import { projectRequestHistory } from '../src/request-history.ts'

const message = (text: string, plugin: string) => createUserMessage({
  content: [{ type: 'text', text }],
  source: { kind: 'plugin', plugin },
})

describe('lossless Phoenix control notice deduplication', () => {
  it('retains the latest duplicate internal notice but preserves intervening user evidence', () => {
    const prior = message('Continue current work', 'model-selection')
    const human = createUserMessage({
      content: [{ type: 'text', text: 'Keep verified findings' }],
      source: { kind: 'user' },
    })
    const newest = message('Continue current work', 'model-selection')
    const unique = message('Different stage', 'model-selection')
    const history = [prior, human, newest, unique]
    const projected = projectRequestHistory(history, undefined)
    expect(projected).toEqual([human, newest, unique])
    expect(history).toHaveLength(4)
  })

  it('never removes external plugin updates or distinct Phoenix instructions', () => {
    const external = message('Same text', 'external-plugin')
    const repeat = message('Same text', 'external-plugin')
    const prior = message('Review one strategy', 'model-selection')
    const next = message('Continue implementation', 'model-selection')
    expect(projectRequestHistory([external, repeat, prior, next], undefined))
      .toEqual([external, repeat, prior, next])
  })

  it('preserves the existing short social projection and avoids reviving tools', () => {
    const human = createUserMessage({
      content: [{ type: 'text', text: 'hola' }],
      source: { kind: 'user' },
    })
    const internal = message('Continue work', 'model-selection')
    expect(projectRequestHistory([internal, human], {
      kind: 'conversational-tail',
      maxMessages: 8,
      maxChars: 12_000,
    })).toEqual([human])
  })
})

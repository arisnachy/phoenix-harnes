// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ComponentProps } from 'react'
import type { ModelDirectoryState } from '../src/client/directory.ts'
import { ContextMeter } from '../src/client/ContextMeter.tsx'
import { en } from '../src/client/locales.ts'

function directory(provider: string | undefined): ComponentProps<typeof ContextMeter>['useDirectory'] {
  const snapshot: ModelDirectoryState | undefined = provider === undefined
    ? undefined
    : {
        current: { provider, model: 'gpt-test' },
        routable: true,
        groups: [],
        failures: [],
        status: 'ready',
        error: null,
      }
  return ((selector: (input: ModelDirectoryState | undefined) => unknown) => selector(snapshot))
    as ComponentProps<typeof ContextMeter>['useDirectory']
}

const t: ComponentProps<typeof ContextMeter>['t'] = (key, params) => {
  const template = (en as Record<string, string>)[key] ?? key
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match)
}

function projection(value: unknown): ComponentProps<typeof ContextMeter>['useProjection'] {
  return ((_key: string, selector?: (input: unknown) => unknown) =>
    selector === undefined ? value : selector(value)) as ComponentProps<typeof ContextMeter>['useProjection']
}

afterEach(cleanup)

describe('ContextMeter', () => {
  it('shows the real remaining context percentage for the OpenAI route', () => {
    render(<ContextMeter
      wide
      useDirectory={directory('openai')}
      useProjection={projection({ projectedTokens: 25_000, contextWindow: 100_000 })}
      t={t}
    />)

    expect(screen.getByRole('status', { name: 'OpenAI context remaining: 75%' })).toBeTruthy()
    expect(screen.getByText('75%')).toBeTruthy()
  })

  it('also recognizes the dedicated ChatGPT Codex route', () => {
    render(<ContextMeter
      wide
      useDirectory={directory('openai-codex')}
      useProjection={projection({ projectedTokens: 10_000, contextWindow: 100_000 })}
      t={t}
    />)

    expect(screen.getByRole('status', { name: 'OpenAI context remaining: 90%' })).toBeTruthy()
  })

  it('stays visible without fabricating a number before token pressure is available', () => {
    render(<ContextMeter
      wide
      useDirectory={directory('openai')}
      useProjection={projection({ contextWindow: 100_000 })}
      t={t}
    />)

    expect(screen.getByRole('status', { name: 'OpenAI context remaining: waiting for usage' })).toBeTruthy()
    expect(screen.getByText('—')).toBeTruthy()
  })

  it('clears stale OpenAI data when the selected route changes', () => {
    const view = render(<ContextMeter
      wide
      useDirectory={directory('openai')}
      useProjection={projection({ projectedTokens: 25_000, contextWindow: 100_000 })}
      t={t}
    />)
    expect(screen.getByText('75%')).toBeTruthy()

    view.rerender(<ContextMeter
      wide
      useDirectory={directory('deepseek-official')}
      useProjection={projection({ projectedTokens: 25_000, contextWindow: 100_000 })}
      t={t}
    />)
    expect(screen.queryByRole('status')).toBeNull()

    view.rerender(<ContextMeter
      wide
      useDirectory={directory('openai-codex')}
      useProjection={projection({ projectedTokens: 10_000, contextWindow: 100_000 })}
      t={t}
    />)
    expect(screen.getByRole('status', { name: 'OpenAI context remaining: 90%' })).toBeTruthy()
  })

  it('does not appear for a non-OpenAI provider or without a selected session', () => {
    const view = render(<ContextMeter
      wide
      useDirectory={directory('deepseek-official')}
      useProjection={projection({ projectedTokens: 1_000, contextWindow: 100_000 })}
      t={t}
    />)
    expect(screen.queryByRole('status')).toBeNull()

    view.rerender(<ContextMeter
      wide
      useDirectory={directory(undefined)}
      useProjection={projection(undefined)}
      t={t}
    />)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('does not clutter the collapsed sidebar rail', () => {
    render(<ContextMeter
      wide={false}
      useDirectory={directory('openai')}
      useProjection={projection({ projectedTokens: 25_000, contextWindow: 100_000 })}
      t={t}
    />)

    expect(screen.queryByRole('status')).toBeNull()
  })
})

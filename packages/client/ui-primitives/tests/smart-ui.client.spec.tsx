// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PhoenixUiIcon, PhoenixStatusPill, PhoenixAgentLine } from '../src/SmartUi.tsx'

describe('shared smart UI primitives', () => {
  it('uses semantic pastel status tokens without remote icon assets', () => {
    const { container } = render(<>
      <PhoenixStatusPill tone="positive" label="Normal" />
      <PhoenixStatusPill tone="warning" label="Revisar" />
      <PhoenixUiIcon name="calculator" />
    </>)
    expect(screen.getByText('Normal').getAttribute('data-tone')).toBe('positive')
    expect(screen.getByText('Revisar').getAttribute('data-tone')).toBe('warning')
    expect(container.querySelectorAll('svg')).toHaveLength(1)
    expect(container.querySelector('img')).toBeNull()
  })
  it('aligns an agent icon, name, role and message in a compact line', () => {
    const { container } = render(<PhoenixAgentLine name="Kira" role="Orquestación"
      icon="bot" message="He preparado el formulario." />)
    expect(container.querySelector('[data-phoenix-agent="Kira"]')).not.toBeNull()
    expect(screen.getByText('Orquestación')).not.toBeNull()
    expect(screen.getByText('He preparado el formulario.')).not.toBeNull()
  })
})

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
  it('renders domain-specific icons without downloading external icon packs', () => {
    const names = ['trophy', 'basketball', 'soccer', 'baseball', 'stethoscope',
      'hospital', 'microscope', 'graduation-cap', 'database', 'wallet', 'map-pin', 'award'] as const
    const { container } = render(<>{names.map(name => <PhoenixUiIcon key={name} name={name} />)}</>)
    expect(container.querySelectorAll('svg')).toHaveLength(names.length)
    expect(container.querySelectorAll('img')).toHaveLength(0)
    expect(container.querySelectorAll('path, circle, rect, ellipse').length).toBeGreaterThan(names.length)
  })
  it('aligns an agent icon, name, role and message in a compact line', () => {
    const { container } = render(<PhoenixAgentLine name="Kira" role="Orquestación"
      icon="bot" message="He preparado el formulario." />)
    expect(container.querySelector('[data-phoenix-agent="Kira"]')).not.toBeNull()
    expect(screen.getByText('Orquestación')).not.toBeNull()
    expect(screen.getByText('He preparado el formulario.')).not.toBeNull()
  })
})


describe('Lucide catalogue and semantic icon palette', () => {
  it('validates installed icon identifiers, preserving legacy icons and rejecting unknown names', async () => {
    const { isPhoenixUiIconName, isPhoenixUiHexColor } = await import('../src/SmartUi.tsx')
    expect(isPhoenixUiIconName('heart-pulse')).toBe(true)
    expect(isPhoenixUiIconName('brain-circuit')).toBe(true)
    expect(isPhoenixUiIconName('chart-column')).toBe(true)
    expect(isPhoenixUiIconName('basketball')).toBe(true)
    expect(isPhoenixUiIconName('script')).toBe(false)
    expect(isPhoenixUiIconName('<svg onload=alert(1)>')).toBe(false)
    expect(isPhoenixUiHexColor('#ff6699')).toBe(true)
    expect(isPhoenixUiHexColor('url(javascript:alert(1))')).toBe(false)
  })
  it('chooses contextually meaningful symbols and status takes palette precedence', async () => {
    const { choosePhoenixUiIcon, choosePhoenixUiTone } = await import('../src/SmartUi.tsx')
    expect(choosePhoenixUiIcon('Pacientes del consultorio')).toBe('stethoscope')
    expect(choosePhoenixUiIcon('Presupuesto mensual')).toBe('wallet')
    expect(choosePhoenixUiIcon('Investigación científica')).toBe('microscope')
    expect(choosePhoenixUiIcon('Aciertos NBA')).toBe('basketball')
    expect(choosePhoenixUiIcon('No reconocido', 'warning')).toBe('triangle-alert')
    expect(choosePhoenixUiTone('Pacientes del consultorio', 'negative')).toBe('negative')
    expect(choosePhoenixUiTone('Presupuesto mensual')).toBe('finance')
  })
  it('renders old SVG icons and new semantic colors consistently', () => {
    const { container } = render(<>
      <PhoenixUiIcon name="stethoscope" label="Paciente" />
      <PhoenixUiIcon name="wallet" label="Presupuesto" color="#aabbcc" />
      <PhoenixUiIcon name="soccer" tone="sports" />
    </>)
    expect(container.querySelectorAll('svg')).toHaveLength(3)
    expect(container.querySelector('[data-tone="medical"]')).not.toBeNull()
    expect(container.querySelector('[data-tone="sports"]')).not.toBeNull()
    expect(container.querySelector('[style*="color"]')).not.toBeNull()
  })
})

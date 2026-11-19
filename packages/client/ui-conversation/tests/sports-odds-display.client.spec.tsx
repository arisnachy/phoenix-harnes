// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SportsOddsDisplay, decimalToAmericanOdds } from '../src/client/chat/SportsOddsDisplay.tsx'

afterEach(cleanup)

const base = {
  title: 'Oklahoma City Thunder vs LA Clippers',
  source: 'ESPN · DraftKings',
  subtitle: 'Mercados reportados por casa; no son probabilidades estimadas',
  note: 'Cuotas observadas al consultar la herramienta.',
  rows: [
    { event: 'Oklahoma City Thunder vs LA Clippers', market: 'h2h',
      selection: 'LA Clippers', bookmaker: 'DraftKings', price: '3.31' },
    { event: 'Oklahoma City Thunder vs LA Clippers', market: 'h2h',
      selection: 'Oklahoma City Thunder', bookmaker: 'DraftKings', price: '1.35' },
  ],
}

describe('PHOENIX inline comparison odds table', () => {
  it('converts original decimal quotes without mutating them', () => {
    expect(decimalToAmericanOdds('1.35')).toBe('-286')
    expect(decimalToAmericanOdds('3.31')).toBe('+231')
    expect(decimalToAmericanOdds('1.50')).toBe('-200')
    expect(decimalToAmericanOdds('2.00')).toBe('+100')
    expect(decimalToAmericanOdds('Por verificar')).toBeNull()
    expect(decimalToAmericanOdds('1.00')).toBeNull()
    expect(decimalToAmericanOdds('2e3')).toBeNull()
    expect(base.rows[0]?.price).toBe('3.31')
  })

  it('shows one flat comparison table with both team columns and the original prices', () => {
    const { container } = render(<SportsOddsDisplay {...base} />)
    expect(container.querySelectorAll('table')).toHaveLength(1)
    expect(container.querySelector('article')).toBeNull()
    expect(screen.getByRole('columnheader', { name: 'Dato investigado' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'LA Clippers' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'Oklahoma City Thunder' })).toBeTruthy()
    expect(screen.getByRole('rowheader', { name: /Ganador · ML/ })).toBeTruthy()
    expect(container.querySelectorAll('[data-market-favorite="true"]')).toHaveLength(1)
    expect(screen.getByText('-286')).toBeTruthy()
    expect(screen.getByText('+231')).toBeTruthy()
    expect(screen.getByText('Decimal 1.35')).toBeTruthy()
    expect(screen.getByText('Favorito por cuota')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Americano' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText(/Casa: DraftKings/)).toBeTruthy()
    expect(screen.getByText(/Cuotas observadas, no probabilidades estimadas/)).toBeTruthy()
  })

  it('switches between American and decimal while retaining provider price', () => {
    render(<SportsOddsDisplay {...base} />)
    fireEvent.click(screen.getByRole('button', { name: 'Decimal' }))
    expect(screen.getByRole('button', { name: 'Decimal' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByLabelText('Cuota 1.35')).toBeTruthy()
    expect(screen.getByText('Americana -286')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Americano' }))
    expect(screen.getByLabelText('Cuota -286')).toBeTruthy()
  })

  it('retains all three 1X2 outcomes, including a draw, in an accessible comparison table', () => {
    render(<SportsOddsDisplay {...base} rows={[
      { event: base.title, market: '1x2', selection: 'Local', bookmaker: 'DraftKings', price: '1.85' },
      { event: base.title, market: '1x2', selection: 'Empate', bookmaker: 'DraftKings', price: '3.20' },
      { event: base.title, market: '1x2', selection: 'Visitante', bookmaker: 'DraftKings', price: '4.70' },
    ]} />)
    expect(screen.getAllByRole('columnheader')).toHaveLength(4)
    expect(screen.getByRole('columnheader', { name: 'Empate' })).toBeTruthy()
    expect(screen.getByRole('rowheader', { name: /Resultado · 1X2/ })).toBeTruthy()
    expect(screen.getByLabelText('Cuota +220')).toBeTruthy()
  })

  it('does not declare a favorite from incomparable or missing prices', () => {
    const { container } = render(<SportsOddsDisplay {...base} rows={[
      { ...base.rows[0]!, price: 'Por verificar' },
      { ...base.rows[1]!, bookmaker: 'Otra casa' },
    ]} />)
    expect(container.querySelectorAll('table')).toHaveLength(2)
    expect(container.querySelector('[data-market-favorite="true"]')).toBeNull()
    expect(screen.getByText('Por verificar')).toBeTruthy()
  })
})

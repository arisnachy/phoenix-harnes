import { useState } from 'react'
import css from './SportsOddsDisplay.module.css'

type OddsRow = {
  event: string
  market: string
  selection: string
  bookmaker: string
  price: string
  point?: string
}

type Props = {
  title: string
  source: string
  subtitle?: string
  note: string
  rows: OddsRow[]
}

/** Presentation only: the provider's original decimal price is never mutated. */
function decimalValue(price: string): number | null {
  const value = price.trim()
  if (!/^\d+(?:\.\d+)?$/u.test(value)) return null
  const decimal = Number(value)
  return Number.isFinite(decimal) && decimal > 1 && decimal <= 1000 ? decimal : null
}

/** Convert decimal to US odds, rounding to the nearest whole American point. */
export function decimalToAmericanOdds(price: string): string | null {
  const decimal = decimalValue(price)
  if (decimal === null) return null
  const american = decimal >= 2
    ? Math.round((decimal - 1) * 100)
    : -Math.round(100 / (decimal - 1))
  return (american > 0 ? '+' : '') + String(american)
}

function marketLabel(market: string): string {
  switch (market.trim().toLowerCase()) {
    case 'h2h': case 'ml': case 'moneyline': return 'Ganador · ML'
    case '1x2': return 'Resultado · 1X2'
    default: return market
  }
}

function initials(selection: string): string {
  return selection.trim().split(/\s+/u).filter(Boolean).slice(0, 2)
    .map(word => word.slice(0, 1)).join('').toLocaleUpperCase() || '•'
}

function marketGroups(rows: readonly OddsRow[]) {
  const grouped = new Map<string, { event: string; market: string; bookmaker: string; rows: OddsRow[] }>()
  for (const row of rows) {
    // An odds pair is comparable only within the same event, market and bookmaker.
    const key = JSON.stringify([row.event, row.market, row.bookmaker])
    const existing = grouped.get(key)
    if (existing) existing.rows.push(row)
    else grouped.set(key, { event: row.event, market: row.market, bookmaker: row.bookmaker, rows: [row] })
  }
  return [...grouped.entries()]
}

/** Compact, source-attributed market viewer; this never selects or places bets. */
export function SportsOddsDisplay({ title, source, subtitle, note, rows }: Props) {
  const [format, setFormat] = useState<'american' | 'decimal'>('american')
  const groups = marketGroups(rows)
  return <section className={css.root} data-generative-ui="sports_odds_card"
    aria-label={'Cuotas observadas · ' + title}>
    <header className={css.header}>
      <div className={css.heading}>
        <div className={css.eyebrow}><span className={css.brand}>PHOENIX</span>
          <span className={css.observed}>Cuotas observadas</span></div>
        <h3>{title}</h3>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <div className={css.formats} role="group" aria-label="Formato de cuotas">
        <button type="button" aria-pressed={format === 'american'}
          onClick={() => setFormat('american')}>Americano</button>
        <button type="button" aria-pressed={format === 'decimal'}
          onClick={() => setFormat('decimal')}>Decimal</button>
      </div>
    </header>
    <div className={css.fixtures}>
      {groups.map(([key, group]) => {
        const showEvent = groups.length > 1 || group.event.trim().toLowerCase() !== title.trim().toLowerCase()
        const winnerMarket = /^(h2h|ml|moneyline|1x2)$/iu.test(group.market.trim())
        const prices = group.rows.map(row => decimalValue(row.price))
        const allPriced = group.rows.length >= 2 && prices.every(value => value !== null)
        const lowest = allPriced ? Math.min(...prices as number[]) : null
        const uniqueLowest = lowest !== null && prices.filter(value => value === lowest).length === 1
        return <article className={css.fixture} key={key}>
          <div className={css.fixtureTop}>
            <div className={css.fixtureIdentity}>
              {showEvent && <strong className={css.fixtureName}>{group.event}</strong>}
              <span className={css.market}>{marketLabel(group.market)}</span>
            </div>
            <span className={css.bookmaker}>{group.bookmaker}</span>
          </div>
          <div className={css.choices}>
            {group.rows.map((row, i) => {
              const american = decimalToAmericanOdds(row.price)
              const favorite = winnerMarket && uniqueLowest && prices[i] === lowest
              const shown = format === 'american' ? american ?? row.price : row.price
              return <div className={css.choice} data-market-favorite={favorite ? 'true' : undefined}
                key={i}>
                <div className={css.team}>
                  <span className={css.monogram} aria-hidden="true">{initials(row.selection)}</span>
                  <div className={css.teamName}>
                    <strong>{row.selection}</strong>
                    {row.point && <small>Línea {row.point}</small>}
                    {favorite && <span className={css.favourite}>Favorito por cuota</span>}
                  </div>
                </div>
                <div className={css.priceBlock}>
                  <strong className={css.price} aria-label={'Cuota ' + shown}>{shown}</strong>
                  {american && <small>{format === 'american' ? 'Decimal ' + row.price : 'Americana ' + american}</small>}
                </div>
              </div>
            })}
          </div>
        </article>
      })}
    </div>
    <footer className={css.footer}>
      <div className={css.attribution}><span>Fuente: {source}</span><span>Precios sujetos a cambios</span></div>
      <details className={css.details}>
        <summary>Fuente, vigencia y advertencias</summary>
        <p>{note}</p>
        <p>Cuotas observadas, no probabilidad estimada ni apuesta aceptada.
          Sin hora de actualización confirmada, comprueba disponibilidad y precio en la casa.
          «Favorito» solo señala la cuota más baja dentro del mismo mercado y operador.</p>
      </details>
    </footer>
  </section>
}

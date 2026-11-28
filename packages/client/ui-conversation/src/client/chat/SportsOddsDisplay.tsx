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

/** Source-attributed, inline comparison table; this never selects or places bets. */
export function SportsOddsDisplay({ title, source, subtitle, note, rows }: Props) {
  const [format, setFormat] = useState<'american' | 'decimal'>('american')
  const groups = marketGroups(rows)
  return <section className={css.root} data-generative-ui="sports_odds_card"
    aria-label={'Cuotas observadas · ' + title}>
    <header className={css.header}>
      <div className={css.step}>
        <span>INVESTIGACIÓN · CUOTAS</span>
        <small>Mercados observados</small>
      </div>
      <h3>Cuotas observadas · {title}</h3>
      {subtitle && <p className={css.subtitle}>{subtitle}</p>}
      <div className={css.formats} role="group" aria-label="Formato de cuotas">
        <button type="button" aria-pressed={format === 'american'}
          onClick={() => { setFormat('american') }}>Americano</button>
        <button type="button" aria-pressed={format === 'decimal'}
          onClick={() => { setFormat('decimal') }}>Decimal</button>
      </div>
    </header>
    <div className={css.fixtures}>
      {groups.map(([key, group]) => {
        const showEvent = groups.length > 1 || group.event.trim().toLowerCase() !== title.trim().toLowerCase()
        const winnerMarket = /^(h2h|ml|moneyline|1x2)$/iu.test(group.market.trim())
        const prices = group.rows.map(row => decimalValue(row.price))
        const allPriced = group.rows.length >= 2 && prices.every(value => value !== null)
        const lowest = allPriced ? Math.min(...prices) : null
        const uniqueLowest = lowest !== null && prices.filter(value => value === lowest).length === 1
        return <div className={css.fixture} key={key}>
          {showEvent && <h4 className={css.fixtureName}>{group.event}</h4>}
          <div className={css.scroll}>
            <table className={css.table} aria-label={marketLabel(group.market) + ' · ' + group.bookmaker}>
              <thead>
                <tr>
                  <th scope="col">Dato investigado</th>
                  {group.rows.map((row, i) => <th scope="col" key={i}>{row.selection}</th>)}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">
                    <span className={css.fact}>{marketLabel(group.market)}</span>
                    <small className={css.meta}>Casa: {group.bookmaker}</small>
                    <small className={css.meta}>Cuota observada; disponibilidad por confirmar</small>
                  </th>
                  {group.rows.map((row, i) => {
                    const american = decimalToAmericanOdds(row.price)
                    const favorite = winnerMarket && uniqueLowest && prices[i] === lowest
                    const shown = format === 'american' ? american ?? row.price : row.price
                    return <td key={i} data-market-favorite={favorite ? 'true' : undefined}>
                      <strong className={css.price} aria-label={'Cuota ' + shown}>{shown}</strong>
                      {american && <small className={css.alternate}>
                        {format === 'american' ? 'Decimal ' + row.price : 'Americana ' + american}
                      </small>}
                      {row.point && <small className={css.meta}>Línea {row.point}</small>}
                      {favorite && <small className={css.favourite}>Favorito por cuota</small>}
                    </td>
                  })}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      })}
    </div>
    <footer className={css.footer}>
      <p>Fuente: {source} · Precios sujetos a cambios.</p>
      <p>{note}</p>
      <p>Cuotas observadas, no probabilidades estimadas ni apuesta aceptada.
        Sin confirmación del precio actual, comprueba la disponibilidad en la casa.
        «Favorito» solo identifica la menor cuota dentro del mismo mercado y operador.</p>
    </footer>
  </section>
}

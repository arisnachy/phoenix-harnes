    case 'sports_ticket_card': {
      const p = block.props
      return <section className={css.sportsCard} data-generative-ui="sports_ticket_card">
        <Header title={p.title} subtitle={p.subtitle} badge="Simulación" />
        <div className={css.sportsLegs}>{p.legs.map((leg,i) => <div key={i} className={css.sportsLeg}>
          <span>{leg.image && <SportsPortrait label={leg.selection} logo={leg.image} />}</span>
          <div><small>{leg.event}{leg.when ? ' · '+leg.when : ''}</small><strong>{leg.selection}</strong>
            <small>{leg.bookmaker}</small></div><b>{leg.price}</b>
        </div>)}</div>
        <div className={css.sportsTicketTotal}><div><small>Cuota total</small><strong>{p.combinedOdds}</strong></div>
          {p.stake && <div><small>Importe simulado</small><strong>{p.stake}</strong></div>}
          {p.grossReturn && <div><small>Retorno bruto potencial</small><strong>{p.grossReturn}</strong></div>}</div>
        <footer className={css.sportsFoot}>Fuente: {p.source}<span>{p.note}</span>
          {p.askPrompt && onAction && <button type="button" onClick={() => onAction(p.askPrompt!, 'draft')}>Revisar selección</button>}
        </footer>
      </section>
    }
    case 'event_card': {
      const { title, subtitle, badge, left, center, right, footer } = block.props
      return (
        <section className={css.card} data-generative-ui="event_card">
          <Header title={title} subtitle={subtitle} badge={badge} />
          <div className={css.eventGrid}>
            <div className={css.participant}><Initial {...left} /><strong>{left.label}</strong>{left.meta && <small>{left.meta}</small>}</div>
            <div className={css.eventCenter}>{center.eyebrow && <small>{center.eyebrow}</small>}<strong>{center.value}</strong>{center.detail && <span>{center.detail}</span>}</div>
            <div className={css.participant}><Initial {...right} /><strong>{right.label}</strong>{right.meta && <small>{right.meta}</small>}</div>
          </div>
          {footer && <footer className={css.footer}>{footer}</footer>}
        </section>
      )
    }
    case 'metric_card':
      return (
        <section className={css.card} data-generative-ui="metric_card">
          <Header title={block.props.title} subtitle={block.props.subtitle} />
          <div className={css.metrics}>
            {block.props.items.map((item, index) => (
              <div className={css.metric} key={`${item.label}-${index}`}><span>{item.label}</span><strong>{item.value}</strong>{item.detail && <small className={statusClass(item.status)}>{item.detail}</small>}</div>
            ))}
          </div>
        </section>
      )
    case 'comparison':
      return (
        <section className={css.card} data-generative-ui="comparison">
          <Header title={block.props.title} subtitle={block.props.subtitle} />
          <div className={css.tableWrap}>
            <table className={css.table}><thead><tr><th scope="col" />{block.props.columns.map(column => <th scope="col" key={column}>{column}</th>)}</tr></thead><tbody>{block.props.rows.map((row, index) => <tr key={`${row.label}-${index}`}><th scope="row">{row.label}</th>{row.values.map((value, cell) => <td key={`${index}-${cell}`}>{value}</td>)}</tr>)}</tbody></table>
          </div>
        </section>
      )
    case 'timeline':
      return (
        <section className={css.card} data-generative-ui="timeline">
          <Header title={block.props.title} subtitle={block.props.subtitle} />
          <ol className={css.timeline}>{block.props.items.map((item, index) => <li key={`${item.title}-${index}`}><span className={`${css.dot} ${statusClass(item.status)}`} /> <div>{item.time && <small>{item.time}</small>}<strong>{item.title}</strong>{item.description && <p>{item.description}</p>}</div></li>)}</ol>
        </section>
      )
    case 'smart_card':
      return (
        <section className={css.card} data-generative-ui="smart_card">
          <Header title={block.props.title} subtitle={block.props.subtitle} badge={block.props.badge} />
          {block.props.description && <p className={css.description}>{block.props.description}</p>}
          {block.props.fields && block.props.fields.length > 0 && <dl className={css.fields}>{block.props.fields.map((field, index) => <div key={`${field.label}-${index}`}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl>}
          {block.props.footer && <footer className={css.footer}>{block.props.footer}</footer>}
        </section>
      )
  }
}
    case 'sports_odds_card': {
      const p=block.props
      return <section className={css.sportsCard} data-generative-ui="sports_odds_card">
        <header className={css.sportsHeadline}><div>
          <span className={css.sportsKicker}>PHOENIX / CUOTAS VERIFICADAS</span><h3>{p.title}</h3>
          {p.subtitle&&<p>{p.subtitle}</p>}</div></header>
        <div className={css.sportsTableScroll}><table className={css.sportsTable}>
          <thead><tr><th>Partido</th><th>Mercado</th><th>Selección</th><th>Casa</th><th>Cuota decimal</th></tr></thead>
          <tbody>{p.rows.map((r,i)=><tr key={i}><th>{r.event}</th><td>{r.market}</td>
            <td>{r.selection}{r.point?' · '+r.point:''}</td><td>{r.bookmaker}</td><td><strong>{r.price}</strong></td></tr>)}</tbody>
        </table></div>
        <footer className={css.sportsSourceBar}><span>Fuente: {p.source}</span><small>{p.note}</small></footer>
      </section>
    }
    case 'sports_ticket_card': {
      const p = block.props
      return <section className={css.sportsCard} data-generative-ui="sports_ticket_card">
        <Header title={p.title} subtitle={p.subtitle} badge="Simulación" />
        <div className={css.sportsLegs}>{p.legs.map((leg,i) => <div key={i} className={css.sportsLeg}>
          <span>{leg.image && <SportsPortrait label={leg.selection} logo={leg.image} />}</span>
          <div><small>{leg.event}{leg.when ? ' · '+leg.when : ''}</small><strong>{leg.selection}</strong>
            <small>{leg.bookmaker}</small></div><b>{leg.price}</b>
        </div>)}</div>
        <div className={css.sportsTicketTotal}><div><small>Cuota total</small><strong>{p.combinedOdds}</strong></div>
          {p.stake && <div><small>Importe simulado</small><strong>{p.stake}</strong></div>}
          {p.grossReturn && <div><small>Retorno bruto potencial</small><strong>{p.grossReturn}</strong></div>}</div>
        <footer className={css.sportsFoot}>Fuente: {p.source}<span>{p.note}</span>
          {p.askPrompt && onAction && <button type="button" onClick={() => onAction(p.askPrompt!, 'draft')}>Revisar selección</button>}
        </footer>
      </section>
    }
    case 'event_card': {
      const { title, subtitle, badge, left, center, right, footer } = block.props
      return (
        <section className={css.card} data-generative-ui="event_card">
          <Header title={title} subtitle={subtitle} badge={badge} />
          <div className={css.eventGrid}>
            <div className={css.participant}><Initial {...left} /><strong>{left.label}</strong>{left.meta && <small>{left.meta}</small>}</div>
            <div className={css.eventCenter}>{center.eyebrow && <small>{center.eyebrow}</small>}<strong>{center.value}</strong>{center.detail && <span>{center.detail}</span>}</div>
            <div className={css.participant}><Initial {...right} /><strong>{right.label}</strong>{right.meta && <small>{right.meta}</small>}</div>
          </div>
          {footer && <footer className={css.footer}>{footer}</footer>}
        </section>
      )
    }
    case 'metric_card':
      return (
        <section className={css.card} data-generative-ui="metric_card">
          <Header title={block.props.title} subtitle={block.props.subtitle} />
          <div className={css.metrics}>
            {block.props.items.map((item, index) => (
              <div className={css.metric} key={`${item.label}-${index}`}><span>{item.label}</span><strong>{item.value}</strong>{item.detail && <small className={statusClass(item.status)}>{item.detail}</small>}</div>
            ))}
          </div>
        </section>
      )
    case 'comparison':
      return (
        <section className={css.card} data-generative-ui="comparison">
          <Header title={block.props.title} subtitle={block.props.subtitle} />
          <div className={css.tableWrap}>
            <table className={css.table}><thead><tr><th scope="col" />{block.props.columns.map(column => <th scope="col" key={column}>{column}</th>)}</tr></thead><tbody>{block.props.rows.map((row, index) => <tr key={`${row.label}-${index}`}><th scope="row">{row.label}</th>{row.values.map((value, cell) => <td key={`${index}-${cell}`}>{value}</td>)}</tr>)}</tbody></table>
          </div>
        </section>
      )
    case 'timeline':
      return (
        <section className={css.card} data-generative-ui="timeline">
          <Header title={block.props.title} subtitle={block.props.subtitle} />
          <ol className={css.timeline}>{block.props.items.map((item, index) => <li key={`${item.title}-${index}`}><span className={`${css.dot} ${statusClass(item.status)}`} /> <div>{item.time && <small>{item.time}</small>}<strong>{item.title}</strong>{item.description && <p>{item.description}</p>}</div></li>)}</ol>
        </section>
      )
    case 'smart_card':
      return (
        <section className={css.card} data-generative-ui="smart_card">
          <Header title={block.props.title} subtitle={block.props.subtitle} badge={block.props.badge} />
          {block.props.description && <p className={css.description}>{block.props.description}</p>}
          {block.props.fields && block.props.fields.length > 0 && <dl className={css.fields}>{block.props.fields.map((field, index) => <div key={`${field.label}-${index}`}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl>}
          {block.props.footer && <footer className={css.footer}>{block.props.footer}</footer>}
        </section>
      )
  }
}

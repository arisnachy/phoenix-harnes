/** Codex reset entry point: redemption stays inside OpenAI's authenticated controls. */
import type { ReactNode } from 'react'
import type { ModelsKey } from './locales.ts'
import styles from './ModelsSection.module.css'

const CODEX_USAGE_URL = 'https://chatgpt.com/codex/settings/usage'

/** Show the official redemption entry without claiming to own account credits. */
export function CodexResetsPanel({ t }: { t: (key: ModelsKey) => string }): ReactNode {
  return (
    <section className={styles['authorizationPanel']} aria-labelledby="codex-resets-heading">
      <h2 id="codex-resets-heading" className={styles['title']}>{t('codexResetsTitle')}</h2>
      <p className={styles['intro']}>{t('codexResetsIntro')}</p>
      <div className={styles['authorizationActions']}>
        <a
          className={styles['secondaryButton']}
          href={CODEX_USAGE_URL}
          target="_blank"
          rel="noopener noreferrer"
        >{t('codexResetsOpenUsage')}</a>
      </div>
      <p className={styles['intro']}>{t('codexResetsCli')}</p>
      <p className={styles['intro']}>{t('codexResetsFallback')}</p>
      <p className={styles['notice']}>{t('codexResetsSafety')}</p>
    </section>
  )
}

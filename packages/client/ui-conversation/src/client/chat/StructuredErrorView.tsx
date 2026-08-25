import type { ReactNode } from 'react'
import { formatStructuredError } from './structured-error.ts'
import css from './StructuredErrorView.module.css'

export interface StructuredErrorViewProps {
  readonly message: string
  readonly code?: string | number
  readonly compact?: boolean
  readonly fallbackClassName?: string
}

/**
 * Human-first projection for provider/tool JSON errors.
 * The complete provider payload remains available, unchanged semantically,
 * behind an explicit disclosure for debugging and support.
 */
export function StructuredErrorView({
  message,
  code,
  compact = false,
  fallbackClassName,
}: StructuredErrorViewProps): ReactNode {
  const structured = formatStructuredError(message, code)
  if (structured === undefined) return <span className={fallbackClassName}>{message}</span>

  return (
    <div className={compact ? css.compact : css.root} data-structured-error>
      <span className={css.heading}>{structured.title}</span>
      {structured.message !== undefined && <span className={css.message}>{structured.message}</span>}

      {structured.fields.length > 0 && (
        <dl className={css.fields}>
          {structured.fields.map((field, index) => (
            <div className={css.field} key={`${field.label}-${index}`}>
              <dt>{field.label}</dt>
              <dd className={field.technical ? css.technical : undefined}>{field.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {structured.action !== undefined && (
        <div className={css.action}>
          <strong>Qué puedes hacer</strong>
          <span>{structured.action}</span>
        </div>
      )}

      <details className={css.raw}>
        <summary className={css.rawSummary}>Ver JSON original</summary>
        <pre className={css.rawJson}>{structured.rawJson}</pre>
      </details>
    </div>
  )
}

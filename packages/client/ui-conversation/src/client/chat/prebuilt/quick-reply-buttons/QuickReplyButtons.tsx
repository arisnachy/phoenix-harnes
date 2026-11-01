// Adapted from https://github.com/hemasurya106/react-generative-ui (v0.4.6, MIT)
import React from 'react';
// Phoenix validates declarative props before this upstream visual component renders.
// Zod-only metadata was omitted so this React 18 adaptation needs no new npm dependency.

/**
 * Recommended registry connection pattern:
 * Since callbacks cannot be sent by the LLM, they must be supplied at render time.
 * Wrap this component in a connected component in your registry setup:
 *
 * ```tsx
 * const QuickReplyButtonsConnected: React.FC<any> = (props) => (
 *   <QuickReplyButtons {...props} onSelect={(id) => handleQuickReply(id)} />
 * );
 * ```
 */
export interface QuickReplyButtonsProps { buttons: Array<{ label: string; id: string }>;
  onSelect?: (id: string) => void;
}

export const QuickReplyButtons: React.FC<QuickReplyButtonsProps> = ({
  buttons,
  onSelect,
}) => {
  return (
    <div style={{
      fontFamily: 'system-ui, -apple-system, sans-serif',
      display: 'flex',
      flexWrap: 'wrap',
      gap: '0.5rem',
      margin: 0,
    }}>
      {buttons.map((btn) => (
        <button
          key={btn.id}
          onClick={() => onSelect?.(btn.id)}
          style={{
            padding: '0.5rem 0.875rem',
            borderRadius: '9999px',
            backgroundColor: 'var(--dsw-alias-surface-primary,transparent)',
            border: '1px solid var(--dsw-alias-border-subtle,rgba(120,120,120,.28))',
            color: 'var(--dsw-alias-label-primary,inherit)',
            fontSize: '0.8125rem',
            fontWeight: 500,
            cursor: 'pointer',
            boxShadow: 'none',
            transition: 'all 0.2s',
            outline: 'none',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'var(--dsw-alias-interactive-bg-hover,rgba(120,120,120,.08))';
            e.currentTarget.style.borderColor = 'var(--dsw-alias-border-subtle,rgba(120,120,120,.4))';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'var(--dsw-alias-surface-primary,transparent)';
            e.currentTarget.style.borderColor = 'var(--dsw-alias-border-subtle,rgba(120,120,120,.28))';
          }}
        >
          {btn.label}
        </button>
      ))}
    </div>
  );
};

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
      margin: '0.75rem 0',
    }}>
      {buttons.map((btn) => (
        <button
          key={btn.id}
          onClick={() => onSelect?.(btn.id)}
          style={{
            padding: '0.5rem 1rem',
            borderRadius: '9999px',
            backgroundColor: '#ffffff',
            border: '1px solid #d1d5db',
            color: '#374151',
            fontSize: '0.875rem',
            fontWeight: 500,
            cursor: 'pointer',
            boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
            transition: 'all 0.2s',
            outline: 'none',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = '#f9fafb';
            e.currentTarget.style.borderColor = '#9ca3af';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = '#ffffff';
            e.currentTarget.style.borderColor = '#d1d5db';
          }}
        >
          {btn.label}
        </button>
      ))}
    </div>
  );
};

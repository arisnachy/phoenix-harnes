// Adapted from https://github.com/hemasurya106/react-generative-ui (v0.4.6, MIT)
import React from 'react';
// Phoenix validates declarative props before this upstream visual component renders.
// Zod-only metadata was omitted so this React 18 adaptation needs no new npm dependency.

export type AlertBoxProps = { type: 'info' | 'success' | 'warning' | 'error'; title?: string; message: string };

const ALERTS_CONFIG = {
  info: {
    color: 'var(--dsw-alias-label-primary,#334155)',
    bg: 'var(--dsw-alias-interactive-bg-hover,rgba(100,116,139,.06))',
    border: 'var(--dsw-alias-border-subtle,rgba(100,116,139,.2))',
    icon: 'ⓘ',
  },
  success: {
    color: '#065f46',
    bg: 'rgba(16,185,129,.065)',
    border: 'rgba(16,185,129,.18)',
    icon: '✅',
  },
  warning: {
    color: '#92400e',
    bg: 'rgba(245,158,11,.065)',
    border: 'rgba(245,158,11,.18)',
    icon: '⚠️',
  },
  error: {
    color: '#991b1b',
    bg: 'rgba(239,68,68,.06)',
    border: 'rgba(239,68,68,.17)',
    icon: '❌',
  },
};

export const AlertBox: React.FC<AlertBoxProps> = ({
  type,
  title,
  message,
}) => {
  const config = ALERTS_CONFIG[type] || ALERTS_CONFIG.info;

  return (
    <div style={{
      fontFamily: 'system-ui, -apple-system, sans-serif',
      padding: '0.75rem 0.875rem',
      borderRadius: '0.75rem',
      backgroundColor: config.bg,
      border: `1px solid ${config.border}`,
      color: config.color,
      display: 'flex',
      gap: '0.625rem',
      margin: 0,
      maxWidth: '100%',
    }}>
      <div style={{ fontSize: '1rem', userSelect: 'none', lineHeight: 1 }}>{config.icon}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
        {title && <span style={{ fontWeight: 600, fontSize: '0.8125rem' }}>{title}</span>}
        <span style={{ fontSize: '0.875rem', lineHeight: 1.5, opacity: 0.9 }}>{message}</span>
      </div>
    </div>
  );
};

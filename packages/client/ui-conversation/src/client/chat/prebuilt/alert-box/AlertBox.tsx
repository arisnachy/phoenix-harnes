// Vendored unchanged from https://github.com/hemasurya106/react-generative-ui (v0.4.6, MIT)
import React from 'react';
import { z } from 'zod';
import { AlertBoxSchema } from './AlertBox.schema';

export { AlertBoxSchema };

export type AlertBoxProps = z.infer<typeof AlertBoxSchema>;

const ALERTS_CONFIG = {
  info: {
    color: '#1e3a8a',
    bg: '#eff6ff',
    border: '#bfdbfe',
    icon: 'ℹ️',
  },
  success: {
    color: '#065f46',
    bg: '#ecfdf5',
    border: '#a7f3d0',
    icon: '✅',
  },
  warning: {
    color: '#92400e',
    bg: '#fffbeb',
    border: '#fde68a',
    icon: '⚠️',
  },
  error: {
    color: '#991b1b',
    bg: '#fef2f2',
    border: '#fca5a5',
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
      padding: '1rem',
      borderRadius: '0.5rem',
      backgroundColor: config.bg,
      border: `1px solid ${config.border}`,
      color: config.color,
      display: 'flex',
      gap: '0.75rem',
      margin: '0.75rem 0',
      maxWidth: '600px',
    }}>
      <div style={{ fontSize: '1.25rem', userSelect: 'none', lineHeight: 1 }}>{config.icon}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
        {title && <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>{title}</span>}
        <span style={{ fontSize: '0.875rem', lineHeight: 1.5, opacity: 0.9 }}>{message}</span>
      </div>
    </div>
  );
};

// Adapted from https://github.com/hemasurya106/react-generative-ui (v0.4.6, MIT)
import React from 'react';
// Phoenix validates declarative props before this upstream visual component renders.
// Zod-only metadata was omitted so this React 18 adaptation needs no new npm dependency.

export type ProgressBarProps = { label?: string; value: number; color?: string };

export const ProgressBar: React.FC<ProgressBarProps> = ({
  label,
  value,
  color = '#3b82f6',
}) => {
  return (
    <div style={{
      fontFamily: 'system-ui, -apple-system, sans-serif',
      margin: '0.75rem 0',
      width: '100%',
      maxWidth: '480px',
    }}>
      {(label || value !== undefined) && (
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginBottom: '0.25rem',
          fontSize: '0.875rem',
          fontWeight: 500,
          color: '#374151',
        }}>
          {label && <span>{label}</span>}
          <span>{value}%</span>
        </div>
      )}
      <div style={{
        height: '0.5rem',
        width: '100%',
        backgroundColor: '#e5e7eb',
        borderRadius: '9999px',
        overflow: 'hidden',
      }}>
        <div style={{
          height: '100%',
          width: `${value}%`,
          backgroundColor: color,
          borderRadius: '9999px',
          transition: 'width 0.5s ease-out',
        }} />
      </div>
    </div>
  );
};

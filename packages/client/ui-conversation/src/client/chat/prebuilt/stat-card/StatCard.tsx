// Adapted from https://github.com/hemasurya106/react-generative-ui (v0.4.6, MIT)
import React from 'react';
// Phoenix validates declarative props before this upstream visual component renders.
// Zod-only metadata was omitted so this React 18 adaptation needs no new npm dependency.

export type StatCardProps = { title: string; value: string | number; change?: string | number; trend?: 'up' | 'down' | 'neutral'; icon?: string };

export const StatCard: React.FC<StatCardProps> = ({
  title,
  value,
  change,
  trend,
  icon,
}) => {
  const isUp = trend === 'up';
  const isDown = trend === 'down';
  const trendColor = isUp ? '#10b981' : isDown ? '#ef4444' : '#6b7280';
  const trendBg = isUp ? '#ecfdf5' : isDown ? '#fef2f2' : '#f3f4f6';

  return (
    <div style={{
      padding: '1.25rem',
      borderRadius: '0.75rem',
      backgroundColor: '#ffffff',
      border: '1px solid #e5e7eb',
      boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)',
      display: 'flex',
      flexDirection: 'column',
      gap: '0.5rem',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      color: '#1f2937',
      maxWidth: '320px',
      margin: '0.5rem 0',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '0.875rem', color: '#6b7280', fontWeight: 500 }}>{title}</span>
        {icon && <span style={{ fontSize: '1.25rem' }}>{icon}</span>}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
        <span style={{ fontSize: '1.875rem', fontWeight: 700, letterSpacing: '-0.025em' }}>{value}</span>
        {change !== undefined && (
          <span style={{
            fontSize: '0.75rem',
            fontWeight: 600,
            color: trendColor,
            backgroundColor: trendBg,
            padding: '0.125rem 0.375rem',
            borderRadius: '0.25rem',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.125rem'
          }}>
            {isUp && '↑'}
            {isDown && '↓'}
            {change}
          </span>
        )}
      </div>
    </div>
  );
};

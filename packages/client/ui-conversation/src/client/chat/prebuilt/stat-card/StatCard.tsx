// Adapted from https://github.com/hemasurya106/react-generative-ui (v0.4.6, MIT)
import React from 'react';
// Phoenix validates declarative props before this upstream visual component renders.
// Zod-only metadata was omitted so this React 18 adaptation needs no new npm dependency.

export type StatCardProps = { title: string; value: string | number; change?: string | number; trend?: 'up' | 'down' | 'neutral'; icon?: string; detail?: string | undefined };

export const StatCard: React.FC<StatCardProps> = ({
  title,
  value,
  change,
  trend,
  icon,
  detail,
}) => {
  const isUp = trend === 'up';
  const isDown = trend === 'down';
  const trendColor = isUp ? '#10b981' : isDown ? '#ef4444' : '#6b7280';
  const trendBg = isUp ? '#ecfdf5' : isDown ? '#fef2f2' : '#f3f4f6';

  return (
    <div style={{
      padding: '0.875rem 1rem',
      borderRadius: '0.875rem',
      backgroundColor: 'var(--dsw-alias-interactive-bg-hover, rgba(120,120,120,.045))',
      border: '1px solid var(--dsw-alias-border-subtle,rgba(120,120,120,.14))',
      boxShadow: 'none',
      display: 'flex',
      flexDirection: 'column',
      gap: '0.375rem',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      color: 'var(--dsw-alias-label-primary,inherit)',
      maxWidth: 'none',
      margin: 0,
      boxSizing: 'border-box',
      width: '100%',
      minWidth: 0,
      height: '100%',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '0.78rem', color: 'var(--dsw-alias-label-secondary,#777)', fontWeight: 550, lineHeight: 1.35 }}>{title}</span>
        {icon && <span style={{ fontSize: '1.25rem' }}>{icon}</span>}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
        <span style={{ fontSize: 'clamp(1.4rem,2.2vw,1.75rem)', fontWeight: 690, letterSpacing: '-0.025em' }}>{value}</span>
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
      {detail && <small style={{ fontSize: '0.73rem', lineHeight: 1.35, color: 'var(--dsw-alias-label-secondary,#777)' }}>{detail}</small>}
    </div>
  );
};

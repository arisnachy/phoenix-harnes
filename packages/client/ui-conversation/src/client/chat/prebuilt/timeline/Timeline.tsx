// Adapted from https://github.com/hemasurya106/react-generative-ui (v0.4.6, MIT)
import React from 'react';
// Phoenix validates declarative props before this upstream visual component renders.
// Zod-only metadata was omitted so this React 18 adaptation needs no new npm dependency.

export type TimelineProps = { title?: string; items: Array<{ date: string; title: string; description?: string }> };

export const Timeline: React.FC<TimelineProps> = ({
  title,
  items,
}) => {
  return (
    <div style={{
      fontFamily: 'system-ui, -apple-system, sans-serif',
      margin: 0,
      maxWidth: '100%',
      padding: '0.125rem 0',
    }}>
      {title && (
        <h3 style={{ margin: '0 0 0.875rem 0', fontSize: '0.9375rem', fontWeight: 600, color: 'var(--dsw-alias-label-primary,inherit)' }}>
          {title}
        </h3>
      )}
      <div style={{
        position: 'relative',
        borderLeft: '2px solid var(--dsw-alias-border-subtle,#ddd)',
        marginLeft: '0.5rem',
        paddingLeft: '1.125rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.875rem',
      }}>
        {items.map((item, index) => (
          <div key={index} style={{ position: 'relative' }}>
            {/* Timeline Dot */}
            <div style={{
              position: 'absolute',
              left: '-1.47rem',
              top: '0.25rem',
              width: '0.625rem',
              height: '0.625rem',
              borderRadius: '50%',
              backgroundColor: '#3b82f6',
              border: '2px solid #ffffff',
              boxShadow: '0 0 0 2px #3b82f6',
            }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase' }}>
                {item.date}
              </span>
              <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#111827' }}>
                {item.title}
              </span>
              {item.description && (
                <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.875rem', color: 'var(--dsw-alias-label-secondary,#777)', lineHeight: 1.5 }}>
                  {item.description}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

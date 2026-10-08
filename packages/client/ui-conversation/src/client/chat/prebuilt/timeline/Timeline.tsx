// Vendored unchanged from https://github.com/hemasurya106/react-generative-ui (v0.4.6, MIT)
import React from 'react';
import { z } from 'zod';
import { TimelineSchema } from './Timeline.schema';

export { TimelineSchema };

export type TimelineProps = z.infer<typeof TimelineSchema>;

export const Timeline: React.FC<TimelineProps> = ({
  title,
  items,
}) => {
  return (
    <div style={{
      fontFamily: 'system-ui, -apple-system, sans-serif',
      margin: '1rem 0',
      maxWidth: '600px',
      padding: '0.5rem 0',
    }}>
      {title && (
        <h3 style={{ margin: '0 0 1.5rem 0', fontSize: '1.125rem', fontWeight: 600, color: '#111827' }}>
          {title}
        </h3>
      )}
      <div style={{
        position: 'relative',
        borderLeft: '2px solid #e5e7eb',
        marginLeft: '0.5rem',
        paddingLeft: '1.5rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '1.5rem',
      }}>
        {items.map((item, index) => (
          <div key={index} style={{ position: 'relative' }}>
            {/* Timeline Dot */}
            <div style={{
              position: 'absolute',
              left: '-1.95rem',
              top: '0.25rem',
              width: '0.75rem',
              height: '0.75rem',
              borderRadius: '50%',
              backgroundColor: '#3b82f6',
              border: '2px solid #ffffff',
              boxShadow: '0 0 0 2px #3b82f6',
            }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase' }}>
                {item.date}
              </span>
              <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#111827' }}>
                {item.title}
              </span>
              {item.description && (
                <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.875rem', color: '#4b5563', lineHeight: 1.5 }}>
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

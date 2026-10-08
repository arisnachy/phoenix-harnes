// Adapted from https://github.com/hemasurya106/react-generative-ui (v0.4.6, MIT)
import React from 'react';
// Phoenix validates declarative props before this upstream visual component renders.
// Zod-only metadata was omitted so this React 18 adaptation needs no new npm dependency.

export type DataTableProps = { title?: string; headers: string[]; rows: Array<Record<string, unknown>> };

export const DataTable: React.FC<DataTableProps> = ({
  title,
  headers,
  rows,
}) => {
  return (
    <div style={{
      fontFamily: 'system-ui, -apple-system, sans-serif',
      margin: 0,
      width: '100%',
      overflowX: 'auto',
      border: '1px solid var(--dsw-alias-border-subtle,rgba(120,120,120,.18))',
      borderRadius: '0.75rem',
      backgroundColor: 'var(--dsw-alias-surface-primary,transparent)',
    }}>
      {title && (
        <div style={{
          padding: '0.75rem 0.875rem',
          borderBottom: '1px solid var(--dsw-alias-border-subtle,rgba(120,120,120,.18))',
          fontWeight: 600,
          fontSize: '0.8125rem',
          color: 'var(--dsw-alias-label-primary,inherit)',
        }}>
          {title}
        </div>
      )}
      <table style={{
        width: '100%',
        borderCollapse: 'collapse',
        textAlign: 'left',
        fontSize: '0.875rem',
      }}>
        <thead>
          <tr style={{ backgroundColor: 'var(--dsw-alias-interactive-bg-hover,rgba(120,120,120,.045))', borderBottom: '1px solid var(--dsw-alias-border-subtle,rgba(120,120,120,.18))' }}>
            {headers.map((h, i) => (
              <th key={i} style={{ padding: '0.625rem 0.75rem', fontWeight: 600, color: 'var(--dsw-alias-label-secondary,#777)' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} style={{ borderBottom: rowIndex === rows.length - 1 ? 'none' : '1px solid #e5e7eb' }}>
              {headers.map((h, colIndex) => {
                const cellValue = row[h] !== undefined ? row[h] : row[h.toLowerCase()];
                return (
                  <td key={colIndex} style={{ padding: '0.75rem 1.25rem', color: 'var(--dsw-alias-label-primary,inherit)' }}>
                    {typeof cellValue === 'boolean' ? (cellValue ? 'Yes' : 'No') : String(cellValue ?? '')}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

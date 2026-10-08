// Vendored unchanged from https://github.com/hemasurya106/react-generative-ui (v0.4.6, MIT)
import React from 'react';
import { z } from 'zod';
import { DataTableSchema } from './DataTable.schema';

export { DataTableSchema };

export type DataTableProps = z.infer<typeof DataTableSchema>;

export const DataTable: React.FC<DataTableProps> = ({
  title,
  headers,
  rows,
}) => {
  return (
    <div style={{
      fontFamily: 'system-ui, -apple-system, sans-serif',
      margin: '1rem 0',
      width: '100%',
      overflowX: 'auto',
      border: '1px solid #e5e7eb',
      borderRadius: '0.5rem',
      backgroundColor: '#ffffff',
    }}>
      {title && (
        <div style={{
          padding: '1rem 1.25rem',
          borderBottom: '1px solid #e5e7eb',
          fontWeight: 600,
          fontSize: '1rem',
          color: '#111827',
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
          <tr style={{ backgroundColor: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
            {headers.map((h, i) => (
              <th key={i} style={{ padding: '0.75rem 1.25rem', fontWeight: 600, color: '#374151' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} style={{ borderBottom: rowIndex === rows.length - 1 ? 'none' : '1px solid #e5e7eb' }}>
              {headers.map((h, colIndex) => {
                const cellValue = row[h] !== undefined ? row[h] : row[h.toLowerCase()];
                return (
                  <td key={colIndex} style={{ padding: '0.75rem 1.25rem', color: '#4b5563' }}>
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

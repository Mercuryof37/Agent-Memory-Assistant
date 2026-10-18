/**
 * V3 components: a tiny set of building blocks shared by the workbench.
 * Kept as plain React.createElement so the esbuild client bundle stays simple.
 */
import * as React from 'react';

export function AmButton({ variant = 'ghost', className = '', children, ...props }) {
  return React.createElement(
    'button',
    { className: `am-btn am-btn-${variant} ${className}`.trim(), ...props },
    children,
  );
}

export function AmBadge({ kind, children }) {
  return React.createElement('span', { className: `am-badge am-badge-${kind}` }, children);
}

export function AmEmpty({ children, action }) {
  return React.createElement(
    'div',
    { className: 'am-empty' },
    children,
    action ? React.createElement('div', { style: { marginTop: '12px' } }, action) : null,
  );
}

export function AmSkeleton({ rows = 3 }) {
  return React.createElement(
    'div',
    { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
    Array.from({ length: rows }, (_, index) => React.createElement('div', { key: index, className: 'am-skeleton' })),
  );
}

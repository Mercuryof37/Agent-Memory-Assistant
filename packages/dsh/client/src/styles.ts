/**
 * V3 visual layer: `am-*` tokens and global CSS.
 *
 * Independent from the host theme variables on purpose: the workbench is its
 * own product surface, and every colour/space decision goes through these
 * tokens so light/dark stay consistent.
 */

export const THEME_KEY = 'agent-memory:theme';
export type Theme = 'light' | 'dark';

export const TOKENS_CSS = `
:root {
  /* Chrome palette: neutral greys, #1a73e8 accent, soft type tints. */
  --am-bg: #f8f9fa;
  --am-surface: #ffffff;
  --am-surface-muted: #f1f3f4;
  --am-border: #dadce0;
  --am-border-strong: #bdc1c6;
  --am-text: #202124;
  --am-text-secondary: #5f6368;
  --am-text-tertiary: #80868b;
  --am-accent: #1a73e8;
  --am-accent-hover: #1765cc;
  --am-accent-soft: #e8f0fe;
  --am-danger: #d93025;
  --am-danger-soft: #fce8e6;
  --am-warn: #e37400;
  --am-success: #188038;
  --am-fact: #1a73e8;
  --am-fact-soft: #e8f0fe;
  --am-pitfall: #b06000;
  --am-pitfall-soft: #fef7e0;
  --am-exp: #188038;
  --am-exp-soft: #e6f4ea;
  --am-radius: 8px;
  --am-radius-lg: 12px;
  --am-shadow: 0 8px 28px rgba(32, 33, 36, 0.14);
  --am-font: Roboto, -apple-system, "Segoe UI", Arial, "Microsoft YaHei", sans-serif;
  --am-mono: "Roboto Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  --am-row-height: 46px;
}
[data-am-theme="dark"] {
  --am-bg: #202124;
  --am-surface: #292a2d;
  --am-surface-muted: #303134;
  --am-border: #3c4043;
  --am-border-strong: #5f6368;
  --am-text: #e8eaed;
  --am-text-secondary: #9aa0a6;
  --am-text-tertiary: #80868b;
  --am-accent: #8ab4f8;
  --am-accent-hover: #aecbfa;
  --am-accent-soft: #283548;
  --am-danger: #f28b82;
  --am-danger-soft: #3c1f1e;
  --am-warn: #fdd663;
  --am-success: #81c995;
  --am-fact: #8ab4f8;
  --am-fact-soft: #1f2b3e;
  --am-pitfall: #fdd663;
  --am-pitfall-soft: #3a3320;
  --am-exp: #81c995;
  --am-exp-soft: #1e3327;
  --am-shadow: 0 12px 36px rgba(0, 0, 0, 0.5);
}
`;

export const GLOBAL_CSS = `
${TOKENS_CSS}
.am-root {
  background: var(--am-bg);
  color: var(--am-text);
  font-family: var(--am-font);
  -webkit-font-smoothing: antialiased;
}
.am-page {
  padding: 28px 40px 56px;
  max-width: 1080px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
}
@media (max-width: 960px) {
  .am-page { padding: 20px 20px 44px; }
}
.am-header {
  display: flex;
  align-items: baseline;
  gap: 14px;
  margin-bottom: 2px;
}
.am-title { font-size: 24px; font-weight: 650; letter-spacing: -0.01em; margin: 0; }
.am-subtitle { color: var(--am-text-secondary); font-size: 13px; line-height: 1.7; margin: 4px 0 0; }
.am-meta { color: var(--am-text-secondary); font-size: 12px; }
.am-toolbar {
  display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
  margin: 18px 0 24px;
}
.am-input, .am-textarea {
  border: 1px solid var(--am-border);
  background: var(--am-surface);
  color: var(--am-text);
  border-radius: 9px;
  padding: 8px 11px;
  font-size: 13px;
  outline: none;
  transition: border-color 150ms ease, box-shadow 150ms ease;
}
.am-input:focus, .am-textarea:focus {
  border-color: var(--am-accent);
  box-shadow: 0 0 0 3px var(--am-accent-soft);
}
.am-btn {
  height: 32px; padding: 0 12px;
  border-radius: 9px;
  border: 1px solid var(--am-border);
  background: var(--am-surface);
  color: var(--am-text);
  font-size: 13px;
  cursor: pointer;
  transition: background 140ms ease, border-color 140ms ease, color 140ms ease;
  white-space: nowrap;
}
.am-btn:hover { background: var(--am-surface-muted); border-color: var(--am-border-strong); }
.am-btn:focus-visible { outline: 2px solid var(--am-accent); outline-offset: 2px; }
.am-btn:disabled { opacity: .5; cursor: not-allowed; }
.am-btn-primary {
  background: var(--am-accent); border-color: var(--am-accent); color: #fff;
}
.am-btn-primary:hover { background: var(--am-accent-hover); border-color: var(--am-accent-hover); }
.am-btn-danger { color: var(--am-danger); border-color: var(--am-border); }
.am-btn-danger:hover { background: var(--am-danger-soft); }
.am-btn-icon { width: 32px; padding: 0; display: inline-flex; align-items: center; justify-content: center; }

.am-row {
  display: flex; align-items: center; gap: 12px;
  min-height: var(--am-row-height);
  padding: 0 12px;
  border-radius: var(--am-radius);
  border: 1px solid transparent;
  background: var(--am-surface);
  color: var(--am-text);
  cursor: pointer;
  text-align: left;
  width: 100%;
  font-size: 14px;
  transition: border-color 140ms ease, background 140ms ease;
}
.am-row:hover { background: var(--am-surface-muted); border-color: var(--am-border); }
.am-row:focus-visible { outline: 2px solid var(--am-accent); outline-offset: -2px; }

.am-badge {
  display: inline-flex; align-items: center;
  height: 22px; padding: 0 8px;
  border-radius: 999px;
  font-family: var(--am-mono);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: .02em;
  white-space: nowrap;
}
.am-badge-fact { color: var(--am-fact); background: var(--am-fact-soft); }
.am-badge-pitfall { color: var(--am-pitfall); background: var(--am-pitfall-soft); }
.am-badge-exp { color: var(--am-exp); background: var(--am-exp-soft); }

.am-card {
  background: var(--am-surface);
  border: 1px solid var(--am-border);
  border-radius: var(--am-radius-lg);
  padding: 16px;
}
.am-detail { margin-top: 18px; }
.am-group-title {
  display: flex; align-items: center; gap: 8px;
  margin: 26px 0 10px;
  font-size: 13px; font-weight: 650;
  color: var(--am-text);
}
.am-notice { font-size: 12px; color: var(--am-success); margin: 8px 0 0; }
.am-empty {
  padding: 40px 16px; text-align: center;
  color: var(--am-text-secondary);
  border: 1px dashed var(--am-border);
  border-radius: var(--am-radius-lg);
  font-size: 13px;
}
.am-skeleton {
  height: var(--am-row-height);
  border-radius: var(--am-radius);
  background: linear-gradient(90deg, var(--am-surface-muted) 25%, var(--am-border) 37%, var(--am-surface-muted) 63%);
  background-size: 400% 100%;
  animation: am-shimmer 1.4s ease infinite;
}
@keyframes am-shimmer { 0% { background-position: 100% 0; } 100% { background-position: 0 0; } }
@media (prefers-reduced-motion: reduce) { .am-skeleton { animation: none; } }

.am-memory-scroll {
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--am-text-tertiary) 45%, transparent) transparent;
  overscroll-behavior: contain;
}
.am-memory-scroll::-webkit-scrollbar { width: 12px; height: 12px; }
.am-memory-scroll::-webkit-scrollbar-track { background: transparent; }
.am-memory-scroll::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--am-text-tertiary) 45%, transparent);
  border: 3px solid transparent;
  background-clip: padding-box;
  border-radius: 999px;
}
.am-memory-scroll::-webkit-scrollbar-thumb:hover {
  background: color-mix(in srgb, var(--am-text-tertiary) 68%, transparent);
  background-clip: padding-box;
}

.am-overlay {
  position: fixed; inset: 0; z-index: 50;
  background: rgba(15, 18, 25, .45);
  display: flex; align-items: center; justify-content: center;
}
.am-modal {
  width: min(560px, calc(100vw - 40px));
  max-height: 76vh; overflow: auto;
  background: var(--am-surface);
  color: var(--am-text);
  border-radius: var(--am-radius-lg);
  padding: 22px 24px;
  border: 1px solid var(--am-border);
  box-shadow: var(--am-shadow);
}
`;

const STYLE_ID = 'am-theme-styles';

export function ensureStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = GLOBAL_CSS;
  document.head.appendChild(style);
}

export function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // localStorage may be unavailable; fall through to the system preference.
  }
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function persistTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Preference stays in memory when storage is blocked.
  }
}

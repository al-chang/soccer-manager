import type { ReactNode } from 'react';
import { useTheme, type ThemePref } from '../store/theme';

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}

function AutoIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}

const OPTIONS: { pref: ThemePref; label: string; icon: ReactNode }[] = [
  { pref: 'light', label: 'Light', icon: <SunIcon /> },
  { pref: 'system', label: 'System', icon: <AutoIcon /> },
  { pref: 'dark', label: 'Dark', icon: <MoonIcon /> },
];

export function ThemeToggle() {
  const pref = useTheme((s) => s.pref);
  const setPref = useTheme((s) => s.setPref);

  return (
    <div className="theme-toggle" role="group" aria-label="Color theme">
      {OPTIONS.map((o) => (
        <button
          key={o.pref}
          type="button"
          className={`theme-opt ${pref === o.pref ? 'active' : ''}`}
          aria-pressed={pref === o.pref}
          title={`${o.label} theme`}
          onClick={() => setPref(o.pref)}
        >
          {o.icon}
          <span className="sr-only">{o.label} theme</span>
        </button>
      ))}
    </div>
  );
}

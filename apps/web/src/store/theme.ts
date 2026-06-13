import { create } from 'zustand';

/** What the user picked. `system` follows the OS `prefers-color-scheme`. */
export type ThemePref = 'system' | 'light' | 'dark';
/** What's actually painted. */
export type EffectiveTheme = 'light' | 'dark';

const STORAGE_KEY = 'sm-theme';

const lightMq = () => window.matchMedia('(prefers-color-scheme: light)');

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    /* private mode / no storage — fall through to default */
  }
  return 'system';
}

function resolve(pref: ThemePref): EffectiveTheme {
  if (pref === 'system') return lightMq().matches ? 'light' : 'dark';
  return pref;
}

function apply(effective: EffectiveTheme) {
  document.documentElement.dataset.theme = effective;
}

interface ThemeStore {
  pref: ThemePref;
  effective: EffectiveTheme;
  setPref: (pref: ThemePref) => void;
}

export const useTheme = create<ThemeStore>((set, get) => {
  const pref = readPref();
  const effective = resolve(pref);
  apply(effective);

  // Track OS changes while the user is on `system`.
  lightMq().addEventListener('change', () => {
    if (get().pref !== 'system') return;
    const next = resolve('system');
    apply(next);
    set({ effective: next });
  });

  return {
    pref,
    effective,
    setPref: (next) => {
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        /* ignore persistence failure; in-session change still applies */
      }
      const effectiveNext = resolve(next);
      apply(effectiveNext);
      set({ pref: next, effective: effectiveNext });
    },
  };
});

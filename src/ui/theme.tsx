/** Application appearance in its two modes.
 *
 *  Dark mode is not a matter of taste. On OLED screens it lowers power draw,
 *  which the efficiency requirement caps at ten per cent per hour, and it
 *  preserves night vision during a hike in low light. That is why the
 *  preference is stored with the profile rather than left to the operating
 *  system setting.
 */
import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';

import { readProfile, saveTheme, Theme } from '../data/db';

export interface Palette {
  background: string;
  surface: string;
  border: string;
  text: string;
  mutedText: string;
  primary: string;
  primarySoft: string;
  onPrimary: string;
  danger: string;
  dangerSoft: string;
  warning: string;
  warningSoft: string;
  success: string;
  successSoft: string;
  canvas: string;
  canvasLine: string;
}

const LIGHT: Palette = {
  background: '#f4f6f8',
  surface: '#ffffff',
  border: '#e1e5ea',
  text: '#15181d',
  mutedText: '#6b7280',
  primary: '#1c5cab',
  primarySoft: '#e8f0fb',
  onPrimary: '#ffffff',
  danger: '#c14e1f',
  dangerSoft: '#fbeee7',
  warning: '#a5761a',
  warningSoft: '#fdf4e3',
  success: '#2f7d4f',
  successSoft: '#e7f3ec',
  canvas: '#e8ece7',
  canvasLine: '#d2d9d0',
};

const DARK: Palette = {
  background: '#0f1216',
  surface: '#171b21',
  border: '#2a313a',
  text: '#eef1f5',
  mutedText: '#9aa4b2',
  primary: '#6da7ec',
  primarySoft: '#17283c',
  onPrimary: '#0f1216',
  danger: '#e87a4d',
  dangerSoft: '#3a221a',
  warning: '#d8a948',
  warningSoft: '#332a16',
  success: '#5fc08a',
  successSoft: '#172c20',
  canvas: '#1b2220',
  canvasLine: '#2d3833',
};

export const sp = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;

interface ThemeContext {
  mode: Theme;
  c: Palette;
  toggle: () => void;
  refresh: () => void;
}

const Ctx = createContext<ThemeContext>({
  mode: 'light',
  c: LIGHT,
  toggle: () => {},
  refresh: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Theme>('light');

  const refresh = useCallback(() => {
    readProfile()
      .then((p) => setMode(p?.theme ?? 'light'))
      .catch(() => setMode('light'));
  }, []);

  useEffect(refresh, [refresh]);

  const toggle = useCallback(() => {
    setMode((current) => {
      const next: Theme = current === 'light' ? 'dark' : 'light';
      saveTheme(next).catch(() => {});
      return next;
    });
  }, []);

  const c = mode === 'dark' ? DARK : LIGHT;
  return <Ctx.Provider value={{ mode, c, toggle, refresh }}>{children}</Ctx.Provider>;
}

export const useTheme = () => useContext(Ctx);

/** Colour tied to each difficulty level, for the catalogue marker. */
export function difficultyColour(c: Palette) {
  return { beginner: c.success, intermediate: c.warning, advanced: c.danger } as const;
}

/** Spanish labels for the values the user sees. */
export const LEVEL_LABEL = {
  beginner: 'principiante',
  intermediate: 'intermedio',
  advanced: 'avanzado',
} as const;

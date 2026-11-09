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

/**
 * The palette.
 *
 * Four tones carry the whole application. A petrol blue, almost a teal,
 * for everything the hiker acts on. A brown for what the ground is made
 * of, which is also the colour paths are drawn in on the map. A dark
 * green for what went well. And a cream the whole thing sits on.
 *
 * They are muted on purpose. This is read outdoors in daylight, where
 * saturated colour competes with the terrain instead of sitting on top of
 * it, and read again at night, where it burns.
 *
 * The map has its own palette, in server/src/tiles/style.ts, and
 * deliberately does not borrow these. A map is read at arm's length and
 * needs its own contrast.
 */
const LIGHT: Palette = {
  background: '#f3f0e6',
  surface: '#fbf9f3',
  border: '#dcd6c6',
  text: '#1b2b2e',
  mutedText: '#6d6a5f',
  // Petrol blue. Primary actions, the active tab, the trail on a card.
  primary: '#1e4147',
  primarySoft: '#dfe7e7',
  onPrimary: '#fbf9f3',
  // Brown, for what needs attention and for the paths themselves.
  danger: '#8a4a2c',
  dangerSoft: '#f3e6dc',
  warning: '#7a5236',
  warningSoft: '#f2e9dd',
  // Dark green, for what is ready and what went well.
  success: '#2f5a46',
  successSoft: '#e1eae4',
  canvas: '#e3e8e6',
  canvasLine: '#cbd5d2',
};

const DARK: Palette = {
  background: '#101718',
  surface: '#192224',
  border: '#2c383a',
  text: '#e9e5d9',
  mutedText: '#98958a',
  primary: '#7fb0b6',
  primarySoft: '#1a2d30',
  onPrimary: '#101718',
  danger: '#c8805c',
  dangerSoft: '#2f2119',
  warning: '#bb9268',
  warningSoft: '#2d2419',
  success: '#7aae92',
  successSoft: '#1a2c24',
  canvas: '#182021',
  canvasLine: '#283335',
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

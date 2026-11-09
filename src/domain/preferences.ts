/** What kind of outing somebody is looking for.
 *
 *  A closed list and not free text, for the same reason the report kinds in
 *  `reports.ts` are closed. A preference is only worth asking for if
 *  something can be done with the answer, and what can be done with it is
 *  matching it against a trail, which needs both sides to speak the same
 *  vocabulary.
 *
 *  Nothing reads these yet. They are asked at the end of signing up and
 *  stored on the device, and the ranking of the catalogue that will use
 *  them is not built. That is deliberate: the question is cheap to ask
 *  while somebody is already answering questions, and expensive to ask
 *  later once they are using the application.
 *
 *  Declared, not inferred. The application could watch which trails get
 *  downloaded and guess, and a later version may; asking is honest about
 *  what is known and lets somebody who has walked nothing at all get a
 *  catalogue that suits them on the first day.
 */

/** The shape of an outing, which is mostly how long it takes. */
export type PreferenceGroup = 'length' | 'terrain' | 'company';

export interface TrailPreference {
  id: string;
  label: string;
  group: PreferenceGroup;
}

export const TRAIL_PREFERENCES: TrailPreference[] = [
  { id: 'short', label: 'Salidas cortas', group: 'length' },
  { id: 'full_day', label: 'Jornada completa', group: 'length' },
  { id: 'multi_day', label: 'Varios días', group: 'length' },
  { id: 'summit', label: 'Cumbres', group: 'terrain' },
  { id: 'water', label: 'Ríos y cascadas', group: 'terrain' },
  { id: 'forest', label: 'Bosque', group: 'terrain' },
  { id: 'marked', label: 'Senderos señalizados', group: 'company' },
  { id: 'quiet', label: 'Poca gente', group: 'company' },
];

const KNOWN = new Set(TRAIL_PREFERENCES.map((p) => p.id));

/** Whether an identifier is one this version of the application ships. */
export const isPreference = (id: string): boolean => KNOWN.has(id);

/**
 * The stored list, cleaned of anything this version does not know.
 *
 * A device that was on a later version and came back, or a stored value
 * that was hand edited, would otherwise put an identifier into the
 * interface that nothing can render. Dropped quietly rather than refused:
 * a preference nobody can read is not worth an error.
 */
export function readPreferences(stored: string | null): string[] {
  if (!stored) return [];
  try {
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === 'string' && KNOWN.has(v));
  } catch {
    return [];
  }
}

/** The list as it is stored, in the order the catalogue declares them. */
export function writePreferences(ids: string[]): string {
  const chosen = new Set(ids.filter(isPreference));
  return JSON.stringify(TRAIL_PREFERENCES.filter((p) => chosen.has(p.id)).map((p) => p.id));
}

/** Spanish headings for each group, which is what the screen shows. */
export const GROUP_LABEL: Record<PreferenceGroup, string> = {
  length: 'Cuánto tiempo',
  terrain: 'Qué paisaje',
  company: 'Cómo preferís el camino',
};

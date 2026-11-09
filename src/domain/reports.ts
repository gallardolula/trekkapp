/** What a hiker can report about the state of a path.
 *
 *  A closed catalogue rather than free text, for three reasons that all
 *  matter. Somebody standing at a washed out ford with cold hands picks
 *  from a list; they do not type. Two people describing the same obstacle
 *  write different sentences, and the application has to be able to tell
 *  that they mean the same thing. And the severity below is what will drive
 *  a trail out of the catalogue when enough people report the same serious
 *  problem, which free text could never support.
 *
 *  `other` exists because the list is never complete, and it is the one
 *  kind that requires a written description. It carries no severity and
 *  will never withdraw a trail on its own: a system cannot act on a
 *  sentence it has not understood.
 *
 *  The identifiers are English and stable, because they are stored, they
 *  travel to the server and they outlive any wording on screen. The labels
 *  are what the hiker reads.
 */

/**
 * How much a report says about whether the path can still be walked.
 *
 * `blocking` means the route cannot be completed as described. `hazard`
 * means it can, with risk somebody should know about beforehand.
 * `notice` is worth passing on and changes nothing about walkability.
 */
export type ReportSeverity = 'blocking' | 'hazard' | 'notice';

export interface ReportKind {
  id: string;
  label: string;
  /** What the hiker reads under the label, to pick the right one. */
  detail: string;
  severity: ReportSeverity;
  /** Whether a written description is required rather than optional. */
  requiresComment?: boolean;
}

export const REPORT_KINDS: ReportKind[] = [
  {
    id: 'path_blocked',
    label: 'Paso cerrado',
    detail: 'Alambrado, derrumbe o vegetación que impide seguir.',
    severity: 'blocking',
  },
  {
    id: 'flooded_ford',
    label: 'Vado crecido',
    detail: 'El arroyo bajó con fuerza y cruzarlo es riesgoso.',
    severity: 'blocking',
  },
  {
    id: 'lost_markings',
    label: 'Marcas borradas',
    detail: 'Se perdió la señalización y es fácil equivocar el rumbo.',
    severity: 'hazard',
  },
  {
    id: 'loose_terrain',
    label: 'Terreno suelto',
    detail: 'Piedra floja o barro donde hay que pisar con cuidado.',
    severity: 'hazard',
  },
  {
    id: 'no_water',
    label: 'Sin agua',
    detail: 'La vertiente o el arroyo que figura en el recorrido está seco.',
    severity: 'notice',
  },
  {
    id: 'livestock',
    label: 'Hacienda suelta',
    detail: 'Animales en el camino, perros de campo o ganado.',
    severity: 'notice',
  },
  {
    id: 'other',
    label: 'Otro',
    detail: 'Contanos con tus palabras qué encontraste.',
    severity: 'notice',
    requiresComment: true,
  },
];

const BY_ID = new Map(REPORT_KINDS.map((k) => [k.id, k]));

export function reportKind(id: string): ReportKind | null {
  return BY_ID.get(id) ?? null;
}

/**
 * How a report reads when its kind is not one this version knows.
 *
 * A device that has not been updated can receive a kind added later, and
 * showing the raw identifier would be worse than showing nothing. The
 * identifier is still returned, so what it was is never lost.
 */
export function reportLabel(id: string): string {
  return BY_ID.get(id)?.label ?? 'Otro aviso';
}

export function reportSeverity(id: string): ReportSeverity {
  return BY_ID.get(id)?.severity ?? 'notice';
}

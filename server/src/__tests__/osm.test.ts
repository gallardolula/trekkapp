/** Turning contributed ways into trails.
 *
 *  The joining is where this can go wrong quietly. Fragments left unjoined
 *  fill the catalogue with three entries of the same name, none of them
 *  the walk; fragments joined too eagerly produce a trail that teleports.
 *  Both look plausible in a list.
 */
import { joinByName, lengthOf, worthWalking, type OsmWay } from '../trails/osm';

let nextId = 1;

/** A way running north from a point, with a point every hundred metres. */
function way(
  name: string,
  from: { lat: number; lon: number },
  points = 12,
  tags: Record<string, string> = {},
): OsmWay {
  return {
    id: nextId++,
    tags: { highway: 'path', name, ...tags },
    geometry: Array.from({ length: points }, (_, i) => ({
      lat: from.lat + i * 0.0009,
      lon: from.lon,
    })),
  };
}

const START = { lat: -31.65, lon: -64.68 };

/** Where a way of `points` samples starting at START ends up. */
const after = (points: number) => ({ lat: START.lat + (points - 1) * 0.0009, lon: START.lon });

describe('joining the fragments of one path', () => {
  it('joins two fragments that meet end to end', () => {
    const joined = joinByName([way('Sendero de la Cruz', START), way('Sendero de la Cruz', after(12))]);
    expect(joined).toHaveLength(1);
    expect(joined[0]!.sources).toHaveLength(2);
  });

  it('joins a fragment drawn backwards', () => {
    // Nothing orients a way in the direction anybody walks it, and half of
    // them are drawn the other way round.
    const second = way('Sendero de la Cruz', after(12));
    second.geometry.reverse();
    const joined = joinByName([way('Sendero de la Cruz', START), second]);
    expect(joined).toHaveLength(1);
  });

  it('joins a fragment that extends the beginning, not only the end', () => {
    const before = { lat: START.lat - 12 * 0.0009, lon: START.lon };
    const joined = joinByName([way('Sendero de la Cruz', START), way('Sendero de la Cruz', before, 13)]);
    expect(joined).toHaveLength(1);
  });

  it('leaves two paths of the same name that do not touch as two', () => {
    const faraway = { lat: -31.9, lon: -64.9 };
    expect(joinByName([way('Sendero', START), way('Sendero', faraway)])).toHaveLength(2);
  });

  it('never joins two paths that merely cross', () => {
    // Different names mean different paths however close they run.
    const joined = joinByName([way('Sendero de la Cruz', START), way('Sendero del Bosque', after(12))]);
    expect(joined).toHaveLength(2);
  });

  it('keeps the whole geometry, without repeating the shared point', () => {
    const joined = joinByName([way('Sendero', START, 12), way('Sendero', after(12), 12)]);
    expect(joined[0]!.points).toHaveLength(23);
  });

  it('ignores a way with no name, which cannot be told from any other', () => {
    expect(joinByName([way('', START)])).toHaveLength(0);
  });

  it('ignores a way with no geometry to speak of', () => {
    expect(joinByName([way('Sendero', START, 1)])).toHaveLength(0);
  });
});

describe('deciding what belongs in a catalogue', () => {
  const joined = (w: OsmWay[]) => joinByName(w)[0]!;

  it('accepts a path long enough to be an outing', () => {
    expect(worthWalking(joined([way('Sendero al Puesto', START, 20)]))).toBe(true);
  });

  it('rejects a connector of a couple of hundred metres', () => {
    expect(worthWalking(joined([way('Bajada', START, 3)]))).toBe(false);
  });

  it('rejects something named as a structure rather than a route', () => {
    // "puente solo peatonal" is in the real data for this area.
    expect(worthWalking(joined([way('puente solo peatonal', START, 20)]))).toBe(false);
  });

  it('rejects a long distance route, which is a different product', () => {
    expect(worthWalking(joined([way('Huella Andina', START, 600)]))).toBe(false);
  });

  it('rejects a loop that never leaves a car park', () => {
    const tight: OsmWay = {
      id: 999,
      tags: { highway: 'path', name: 'Circuito' },
      geometry: Array.from({ length: 200 }, (_, i) => ({
        lat: START.lat + Math.sin(i / 8) * 0.0008,
        lon: START.lon + Math.cos(i / 8) * 0.0008,
      })),
    };
    expect(worthWalking(joined([tight]))).toBe(false);
  });
});

describe('measuring', () => {
  it('follows the ground rather than the straight line', () => {
    const line = joinByName([way('Sendero', START, 11)])[0]!.points;
    // Ten legs of roughly a hundred metres.
    expect(lengthOf(line)).toBeGreaterThan(900);
    expect(lengthOf(line)).toBeLessThan(1100);
  });
});

describe('what the real data makes you reject', () => {
  const joined = (w: OsmWay[]) => joinByName(w)[0]!;
  const long = (name: string, tags: Record<string, string> = {}) =>
    joined([way(name, START, 20, tags)]);

  it('rejects a provincial route, which is a road however it is tagged', () => {
    // Tagged as a track in the data for this area, and somebody following
    // it on foot is walking on a road.
    expect(worthWalking(long('Ruta Provincial 14'))).toBe(false);
    expect(worthWalking(long('Ex Ruta Nacional 36'))).toBe(false);
  });

  it('rejects a line whose own name records a doubt', () => {
    // "Sendero supuesto" and "Sendero Supuesto - A Investigar" are both
    // real. Passing them on as trails turns an honest note into a claim.
    expect(worthWalking(long('Sendero supuesto'))).toBe(false);
    expect(worthWalking(long('Sendero Supuesto -  A Investigar'))).toBe(false);
  });

  it('rejects a paved track, which is a road whatever it is called', () => {
    expect(worthWalking(long('Camino del Molino', { surface: 'asphalt' }))).toBe(false);
  });

  it('keeps a camino that is a real walk', () => {
    // Not everything called camino is a road, and cattle tracks are how
    // most of these hills are crossed.
    expect(worthWalking(long('Camino para sacar las Vacas', { surface: 'ground' }))).toBe(true);
  });
});

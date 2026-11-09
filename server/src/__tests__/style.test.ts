/** The map style, checked against the data the tiles actually hold.
 *
 *  A style fails silently. A layer naming a source layer that does not
 *  exist, or filtering on a field the schema never had, draws nothing and
 *  reports nothing, which is how the map ended up a white sheet with a line
 *  on it. These tests are the only thing standing between that and a hiker
 *  on a ridge.
 */
import { buildStyle } from '../tiles/style';

const REGION = {
  id: 'sierras-de-cordoba',
  name: 'Sierras de Córdoba',
  bounds: { west: -65.084, south: -32.152, east: -64.05, north: -30.801 },
  minZoom: 6,
  maxZoom: 14,
};

/** The layers the generated archive declares, from its own metadata. */
const IN_THE_TILES = [
  'aerodrome_label',
  'aeroway',
  'boundary',
  'building',
  'housenumber',
  'landcover',
  'landuse',
  'mountain_peak',
  'park',
  'place',
  'poi',
  'transportation',
  'transportation_name',
  'water',
  'water_name',
  'waterway',
];

const style = buildStyle('http://192.168.1.7:4000', REGION);
const layers = style.layers as Record<string, unknown>[];

describe('what the style points at', () => {
  it('asks the same server for its tiles', () => {
    const source = (style.sources as Record<string, { tiles: string[] }>)['trekkapp']!;
    expect(source.tiles[0]).toBe(
      'http://192.168.1.7:4000/api/regions/sierras-de-cordoba/tiles/{z}/{x}/{y}.pbf',
    );
  });

  it('declares where the letters come from', () => {
    // Without this MapLibre renders no text at all, which is not an error
    // anywhere: the labels simply never appear.
    expect(style.glyphs).toBe('http://192.168.1.7:4000/fonts/{fontstack}/{range}.pbf');
  });

  it('names only source layers the archive holds', () => {
    const named = layers
      .map((l) => l['source-layer'])
      .filter((n): n is string => typeof n === 'string');
    expect(named.length).toBeGreaterThan(0);
    for (const name of new Set(named)) expect(IN_THE_TILES).toContain(name);
  });

  it('gives every layer that reads data a source', () => {
    for (const l of layers) {
      if (l['type'] === 'background') continue;
      expect(l['source']).toBe('trekkapp');
      expect(typeof l['source-layer']).toBe('string');
    }
  });

  it('gives every layer a distinct identifier', () => {
    const ids = layers.map((l) => l['id']);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('what a walking map has to show', () => {
  const byId = (id: string) => layers.find((l) => l['id'] === id);
  const drawing = (sourceLayer: string) =>
    layers.filter((l) => l['source-layer'] === sourceLayer);

  it('draws the footpaths, which are the subject', () => {
    expect(drawing('transportation').some((l) => l['id'] === 'path')).toBe(true);
  });

  it('draws a footpath wider than a minor road at walking zoom', () => {
    // The opposite of what a driving map does, and the whole point of this
    // one. Both widths grow with zoom, so they are compared at z17.
    const widthAt17 = (id: string) => {
      const paint = byId(id)!['paint'] as Record<string, unknown>;
      const expression = paint['line-width'] as unknown[];
      // ['interpolate', ['linear'], ['zoom'], z, w, z, w, …]
      const stops = expression.slice(3) as number[];
      return stops[stops.length - 1]!;
    };
    expect(widthAt17('path')).toBeGreaterThan(0);
    expect(byId('path-halo')).toBeDefined();
  });

  it('puts the paths above the roads in the drawing order', () => {
    const at = (id: string) => layers.findIndex((l) => l['id'] === id);
    expect(at('path')).toBeGreaterThan(at('road-major'));
    expect(at('path')).toBeGreaterThan(at('road-minor'));
  });

  it('labels the peaks with their height', () => {
    const field = JSON.stringify((byId('peak-label')!['layout'] as Record<string, unknown>)['text-field']);
    expect(field).toContain('ele');
  });

  it('tells a stream that runs all year from one that does not', () => {
    // Somebody planning where to refill a bottle depends on the difference.
    expect(byId('waterway')).toBeDefined();
    expect(byId('waterway-intermittent')).toBeDefined();
    const dashed = (byId('waterway-intermittent')!['paint'] as Record<string, unknown>)[
      'line-dasharray'
    ];
    expect(dashed).toBeDefined();
  });

  it('draws the protected areas and names them', () => {
    expect(drawing('park').length).toBeGreaterThanOrEqual(3);
  });

  it('shows the shelters, springs and viewpoints a walker looks for', () => {
    const filter = JSON.stringify(byId('poi-dot')!['filter']);
    for (const subclass of ['alpine_hut', 'drinking_water', 'spring', 'viewpoint']) {
      expect(filter).toContain(subclass);
    }
  });

  it('writes the place names, so somebody can tell where they are', () => {
    expect(byId('place-label')).toBeDefined();
    expect((byId('place-label')!['layout'] as Record<string, unknown>)['text-field']).toBeDefined();
  });
});

describe('the labels', () => {
  const symbols = layers.filter((l) => l['type'] === 'symbol');

  it('exist at all, which they did not before', () => {
    expect(symbols.length).toBeGreaterThanOrEqual(7);
  });

  it('only ask for the two faces the server holds', () => {
    // A stack naming a face the server does not have renders as nothing.
    const held = ['Noto Sans Regular', 'Noto Sans Bold'];
    for (const l of symbols) {
      const fonts = (l['layout'] as Record<string, unknown>)['text-font'] as string[];
      expect(fonts).toBeDefined();
      for (const f of fonts) expect(held).toContain(f);
    }
  });

  it('carry a halo, because text over terrain is unreadable without one', () => {
    for (const l of symbols) {
      const paint = l['paint'] as Record<string, unknown>;
      expect(paint['text-halo-width']).toBeDefined();
    }
  });

  it('prefer the Spanish name where the data carries one', () => {
    const field = JSON.stringify(
      (layers.find((l) => l['id'] === 'place-label')!['layout'] as Record<string, unknown>)[
        'text-field'
      ],
    );
    expect(field).toContain('name:es');
  });
});

describe('telling a phone its map is out of date', () => {
  it('folds the style revision into the region version', async () => {
    // A pack holds the glyphs the style asked for, so a style that starts
    // drawing labels leaves every pack already downloaded incomplete,
    // without one tile having changed. Without this the application would
    // report the map as up to date and somebody would find out on a ridge.
    const { STYLE_REVISION } = await import('../tiles/style');
    const { describe: describeRegion } = await import('../tiles/archive');
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { DatabaseSync } = await import('node:sqlite');

    const directory = mkdtempSync(join(tmpdir(), 'trekkapp-style-'));
    const db = new DatabaseSync(join(directory, 'sierras-de-cordoba.mbtiles'));
    db.exec('CREATE TABLE tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB)');
    db.close();
    writeFileSync(join(directory, '..', 'regions.json'), '{}');

    const status = describeRegion(directory, { ...REGION, description: 'Para la prueba.' });
    expect(status.version.endsWith(`-s${STYLE_REVISION}`)).toBe(true);

    rmSync(directory, { recursive: true, force: true });
  });
});

describe('the contours', () => {
  const withContours = buildStyle('http://x', { ...REGION, contours: true });
  const without = buildStyle('http://x', { ...REGION, contours: false });
  const layersOf = (s: ReturnType<typeof buildStyle>) => s.layers as Record<string, unknown>[];

  it('are not declared at all when the region has no archive', () => {
    // A source nobody can answer leaves the map asking for tiles that are
    // not there, on every pan, for the whole walk.
    expect(Object.keys(without.sources as object)).toEqual(['trekkapp']);
    expect(layersOf(without).some((l) => l['source'] === 'contours')).toBe(false);
  });

  it('come from their own source when the region has one', () => {
    const source = (withContours.sources as Record<string, { tiles: string[] }>)['contours']!;
    expect(source.tiles[0]).toBe(
      'http://x/api/regions/sierras-de-cordoba/contours/{z}/{x}/{y}.pbf',
    );
  });

  it('are drawn in two weights, so a slope can be counted', () => {
    const ids = layersOf(withContours).map((l) => l['id']);
    expect(ids).toContain('contour');
    expect(ids).toContain('contour-index');
  });

  it('label only the heavier line', () => {
    const label = layersOf(withContours).find((l) => l['id'] === 'contour-label')!;
    expect(JSON.stringify(label['filter'])).toContain('index');
    expect(label['type']).toBe('symbol');
  });

  it('write the height in metres along the line', () => {
    const layout = layersOf(withContours).find((l) => l['id'] === 'contour-label')![
      'layout'
    ] as Record<string, unknown>;
    expect(JSON.stringify(layout['text-field'])).toContain('ele');
    expect(layout['symbol-placement']).toBe('line');
  });

  it('sit under the water and over the ground, as a printed map has them', () => {
    const at = (id: string) => layersOf(withContours).findIndex((l) => l['id'] === id);
    expect(at('contour')).toBeGreaterThan(at('landcover-wood'));
    expect(at('contour')).toBeLessThan(at('water'));
  });

  it('only ask for the faces the server holds', () => {
    const fonts = (
      layersOf(withContours).find((l) => l['id'] === 'contour-label')!['layout'] as Record<
        string,
        unknown
      >
    )['text-font'] as string[];
    for (const f of fonts) expect(['Noto Sans Regular', 'Noto Sans Bold']).toContain(f);
  });
});

describe('expressions MapLibre will accept', () => {
  /** Every expression in a layer's paint and layout, flattened. */
  function expressions(layer: Record<string, unknown>): unknown[][] {
    const found: unknown[][] = [];
    const walk = (value: unknown) => {
      if (!Array.isArray(value)) return;
      found.push(value as unknown[]);
      for (const child of value) walk(child);
    };
    for (const group of ['paint', 'layout', 'filter']) {
      const block = layer[group];
      if (group === 'filter') walk(block);
      else if (block) for (const v of Object.values(block as object)) walk(v);
    }
    return found;
  }

  it('never nests one zoom interpolation inside another', () => {
    // MapLibre allows exactly one zoom based subexpression per property.
    // A second one makes it refuse the layer, and it says so only as a
    // warning in the device log, so nothing here would otherwise notice.
    const zoomBased = (e: unknown[]) =>
      (e[0] === 'interpolate' || e[0] === 'step') &&
      JSON.stringify(e).includes('["zoom"]');

    for (const layer of layers) {
      for (const expression of expressions(layer)) {
        if (!zoomBased(expression)) continue;
        // Its own operands must not hold another one.
        const inner = expression
          .slice(1)
          .flatMap((operand) => (Array.isArray(operand) ? [operand] : []));
        const nested = JSON.stringify(inner).match(/\["zoom"\]/g)?.length ?? 0;
        expect({ layer: layer['id'], nested }).toEqual({ layer: layer['id'], nested: 1 });
      }
    }
  });
});

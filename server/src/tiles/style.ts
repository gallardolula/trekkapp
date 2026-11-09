/** The style the offline map is drawn with.
 *
 *  A vector tile holds geometry and attributes and no appearance at all, so
 *  this document is the whole of what the map looks like. The tiles carry
 *  sixteen layers of OpenMapTiles data; the previous style painted seven of
 *  them and no text whatsoever, which is why the map read as a white sheet
 *  with a line on it.
 *
 *  It is a walking map, and that decides every conflict. A footpath is drawn
 *  more prominently than a provincial road, because on this map the path is
 *  the subject and the road is context. Peaks carry their height, because
 *  that is how somebody in the Sierras knows which summit they are looking
 *  at. Water that dries up is drawn differently from water that does not,
 *  because a hiker planning where to refill needs to know the difference.
 *
 *  There is no sprite sheet, so nothing here uses `icon-image`. Points are
 *  circles with their name beside them, which costs no extra download and
 *  survives any change of palette.
 */

export interface StyleRegion {
  id: string;
  name: string;
  bounds: { west: number; south: number; east: number; north: number };
  minZoom: number;
  maxZoom: number;
  /** Whether this region has a contour archive beside its basemap. */
  contours?: boolean;
}

const SOURCE = 'trekkapp';
const CONTOURS = 'contours';

/** What the contour archive was generated with. See tiles/make-contours.ts. */
const CONTOUR_INTERVAL = 25;
const CONTOUR_MIN_ZOOM = 11;
const CONTOUR_MAX_ZOOM = 14;

/**
 * Bumped whenever this file changes what a phone would have to hold.
 *
 * A downloaded region is not only tiles. It is tiles plus the glyphs and
 * the sprites the style asked for, packed at download time, so a style that
 * starts drawing labels makes every pack already on a phone incomplete
 * without a single tile having changed. The region version folds this in,
 * which is what lets the application say the map is out of date instead of
 * leaving somebody to discover it where there is no signal.
 */
export const STYLE_REVISION = 4;

// The palette of the map itself, which is not the application's. A map is
// read at arm's length in daylight and needs its own contrast; borrowing
// the interface colours makes the terrain compete with the controls.
const PAPER = '#f4f1e8';
const WOOD = '#cfdfc0';
const SCRUB = '#dde5cb';
const GRASS = '#e4ead3';
const ROCK = '#e3ded2';
const FARMLAND = '#eeead9';
const WATER = '#a8cbe2';
const WATER_LINE = '#7fb0cf';
const PARK = '#cfe2c4';
const PARK_EDGE = '#86ad78';
const BUILT = '#e6e0d4';
const BUILDING = '#ddd5c6';
const ROAD = '#ffffff';
const ROAD_EDGE = '#d9d2c4';
const MAJOR = '#f6e3b8';
const MAJOR_EDGE = '#d9bd84';
const PATH = '#a3511f';
const CONTOUR = '#a08a63';
const INK = '#3d3a33';
const INK_SOFT = '#6f6a5e';
const HALO = '#f7f5ef';

// The raw OpenStreetMap values, not the derived class, because that is
// where a shelter, a spring and a viewpoint keep their identity.
const WHAT_A_WALKER_LOOKS_FOR = [
  'alpine_hut', 'wilderness_hut', 'shelter', 'drinking_water', 'spring',
  'water_point', 'picnic_site', 'camp_site', 'viewpoint', 'information',
  'guidepost', 'toilets', 'parking',
];

// The ones worth the space of a name beside the dot.
const WORTH_NAMING = [
  'alpine_hut', 'wilderness_hut', 'shelter', 'drinking_water', 'spring',
  'water_point', 'picnic_site', 'camp_site', 'viewpoint',
];

const REGULAR = ['Noto Sans Regular'];
const BOLD = ['Noto Sans Bold'];

/** Prefers the Spanish name, which the Argentine data mostly carries. */
const NAME = ['coalesce', ['get', 'name:es'], ['get', 'name'], ''];

/**
 * How big a name is drawn, by what kind of place it names.
 *
 * Not zoom based, so it can sit inside the outputs of a zoom
 * interpolation without being a second one.
 */
const bySize = (city: number, town: number, rest: number) => [
  'match',
  ['get', 'class'],
  'city',
  city,
  'town',
  town,
  rest,
];

/** Smooth growth with zoom, the shape nearly every width and size uses. */
const byZoom = (stops: [number, number][]) => [
  'interpolate',
  ['linear'],
  ['zoom'],
  ...stops.flat(),
];

export function buildStyle(origin: string, region: StyleRegion) {
  return {
    version: 8,
    name: region.name,
    // Without this the map renders every label as nothing at all, which is
    // exactly what it was doing. MapLibre asks for the letter shapes as
    // signed distance fields, in ranges, and the offline downloader packs
    // whatever the style points at.
    glyphs: `${origin}/fonts/{fontstack}/{range}.pbf`,
    sources: {
      ...(region.contours
        ? {
            [CONTOURS]: {
              type: 'vector',
              tiles: [`${origin}/api/regions/${region.id}/contours/{z}/{x}/{y}.pbf`],
              minzoom: CONTOUR_MIN_ZOOM,
              maxzoom: CONTOUR_MAX_ZOOM,
              bounds: [
                region.bounds.west,
                region.bounds.south,
                region.bounds.east,
                region.bounds.north,
              ],
            },
          }
        : {}),
      [SOURCE]: {
        type: 'vector',
        tiles: [`${origin}/api/regions/${region.id}/tiles/{z}/{x}/{y}.pbf`],
        minzoom: region.minZoom,
        maxzoom: region.maxZoom,
        bounds: [region.bounds.west, region.bounds.south, region.bounds.east, region.bounds.north],
      },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': PAPER } },

      // ------------------------------------------------------------ ground --

      layer('landcover-farmland', 'fill', 'landcover', {
        filter: ['==', ['get', 'class'], 'farmland'],
        paint: { 'fill-color': FARMLAND },
      }),
      layer('landcover-grass', 'fill', 'landcover', {
        filter: ['match', ['get', 'class'], ['grass', 'wetland'], true, false],
        paint: { 'fill-color': GRASS },
      }),
      layer('landcover-scrub', 'fill', 'landcover', {
        filter: ['==', ['get', 'class'], 'scrub'],
        paint: { 'fill-color': SCRUB },
      }),
      layer('landcover-wood', 'fill', 'landcover', {
        filter: ['==', ['get', 'class'], 'wood'],
        paint: { 'fill-color': WOOD },
      }),
      // Bare rock above the tree line, which in the Sierras is most of what
      // the high trails cross.
      layer('landcover-rock', 'fill', 'landcover', {
        filter: ['match', ['get', 'class'], ['rock', 'sand'], true, false],
        paint: { 'fill-color': ROCK },
      }),

      layer('landuse-built', 'fill', 'landuse', {
        filter: [
          'match',
          ['get', 'class'],
          ['residential', 'commercial', 'industrial', 'quarry', 'military'],
          true,
          false,
        ],
        paint: { 'fill-color': BUILT, 'fill-opacity': 0.7 },
      }),

      // The protected areas, which is where most of these trails run. Drawn
      // as a tinted field with its own edge so the boundary is legible: on
      // the ground it decides whether a permit is needed.
      layer('park-fill', 'fill', 'park', {
        paint: { 'fill-color': PARK, 'fill-opacity': 0.55 },
      }),
      layer('park-outline', 'line', 'park', {
        paint: { 'line-color': PARK_EDGE, 'line-width': 1.2, 'line-dasharray': [3, 2] },
      }),

      // ---------------------------------------------------------- contours --
      // Above the ground and under the water, which is where a printed map
      // puts them. Drawn at all only when the region carries the archive,
      // because a source nobody can answer leaves the map asking for tiles
      // that are not there.
      //
      // Two weights. Without the heavier line every so often, a slope is a
      // set of identical stripes nobody can count; the index line is the
      // one that carries its height, and the rest are counted from it.
      ...(region.contours
        ? [
            {
              id: 'contour',
              type: 'line',
              source: CONTOURS,
              'source-layer': 'contours',
              filter: ['!=', ['get', 'index'], true],
              minzoom: 12,
              paint: {
                'line-color': CONTOUR,
                'line-opacity': byZoom([
                  [12, 0.25],
                  [14, 0.5],
                ]),
                'line-width': byZoom([
                  [12, 0.5],
                  [16, 0.9],
                ]),
              },
            },
            {
              id: 'contour-index',
              type: 'line',
              source: CONTOURS,
              'source-layer': 'contours',
              filter: ['==', ['get', 'index'], true],
              minzoom: 11,
              paint: {
                'line-color': CONTOUR,
                'line-opacity': byZoom([
                  [11, 0.35],
                  [14, 0.7],
                ]),
                'line-width': byZoom([
                  [11, 0.7],
                  [16, 1.6],
                ]),
              },
            },
            {
              id: 'contour-label',
              type: 'symbol',
              source: CONTOURS,
              'source-layer': 'contours',
              filter: ['==', ['get', 'index'], true],
              minzoom: 13,
              layout: {
                'text-field': ['concat', ['to-string', ['get', 'ele']], ' m'],
                'text-font': REGULAR,
                'text-size': 10,
                'symbol-placement': 'line',
                'symbol-spacing': 400,
                // Written along the slope rather than across it, which is
                // how the number is read on a paper map.
                'text-rotation-alignment': 'map',
                'text-pitch-alignment': 'viewport',
              },
              paint: {
                'text-color': '#7a6a4c',
                'text-halo-color': HALO,
                'text-halo-width': 1.6,
              },
            },
          ]
        : []),

      // ------------------------------------------------------------- water --

      layer('water', 'fill', 'water', {
        paint: {
          'fill-color': WATER,
          // A lagoon that dries up in winter is not a lagoon to plan around.
          'fill-opacity': ['case', ['==', ['get', 'intermittent'], 1], 0.45, 1],
        },
      }),
      layer('waterway', 'line', 'waterway', {
        filter: ['!=', ['get', 'intermittent'], 1],
        paint: {
          'line-color': WATER_LINE,
          'line-width': byZoom([
            [10, 0.6],
            [14, 1.8],
            [17, 3.2],
          ]),
        },
      }),
      // A stream that only runs after rain, dashed. Somebody counting on it
      // to refill a bottle has to be able to tell.
      layer('waterway-intermittent', 'line', 'waterway', {
        filter: ['==', ['get', 'intermittent'], 1],
        paint: {
          'line-color': WATER_LINE,
          'line-opacity': 0.75,
          'line-dasharray': [3, 2],
          'line-width': byZoom([
            [10, 0.5],
            [14, 1.4],
            [17, 2.6],
          ]),
        },
      }),

      // ---------------------------------------------------------- buildings --

      layer('building', 'fill', 'building', {
        minzoom: 14,
        paint: { 'fill-color': BUILDING, 'fill-opacity': 0.9 },
      }),

      // ------------------------------------------------------------- roads --
      // Drawn casing first so every road gets an outline and none of them
      // disappear into the pale ground, which is what used to happen.

      layer('road-minor-casing', 'line', 'transportation', {
        filter: ['match', ['get', 'class'], ['minor', 'service'], true, false],
        minzoom: 12,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': ROAD_EDGE,
          'line-width': byZoom([
            [12, 1.6],
            [16, 7],
          ]),
        },
      }),
      layer('road-minor', 'line', 'transportation', {
        filter: ['match', ['get', 'class'], ['minor', 'service'], true, false],
        minzoom: 12,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': ROAD,
          'line-width': byZoom([
            [12, 0.6],
            [16, 5],
          ]),
        },
      }),
      layer('road-major-casing', 'line', 'transportation', {
        filter: [
          'match',
          ['get', 'class'],
          ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'],
          true,
          false,
        ],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': MAJOR_EDGE,
          'line-width': byZoom([
            [8, 1.4],
            [12, 4],
            [16, 11],
          ]),
        },
      }),
      layer('road-major', 'line', 'transportation', {
        filter: [
          'match',
          ['get', 'class'],
          ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'],
          true,
          false,
        ],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': MAJOR,
          'line-width': byZoom([
            [8, 0.8],
            [12, 2.6],
            [16, 8],
          ]),
        },
      }),

      // ------------------------------------------------------------- paths --
      // The subject of the map. Above the roads in the drawing order and
      // wider than they are at walking zooms, which is the opposite of what
      // a driving map does and the whole point of this one.

      layer('track', 'line', 'transportation', {
        filter: ['==', ['get', 'class'], 'track'],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': PATH,
          'line-opacity': 0.75,
          'line-dasharray': [4, 1.5],
          'line-width': byZoom([
            [11, 0.8],
            [14, 2],
            [17, 3.4],
          ]),
        },
      }),
      // A halo under the footpaths, so they stay readable crossing woodland
      // and rock alike.
      layer('path-halo', 'line', 'transportation', {
        filter: ['==', ['get', 'class'], 'path'],
        minzoom: 11,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': HALO,
          'line-opacity': 0.85,
          'line-width': byZoom([
            [11, 2.4],
            [14, 5],
            [17, 8],
          ]),
        },
      }),
      layer('path', 'line', 'transportation', {
        filter: ['==', ['get', 'class'], 'path'],
        minzoom: 11,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': PATH,
          'line-dasharray': [2.5, 1.2],
          'line-width': byZoom([
            [11, 1],
            [14, 2.4],
            [17, 4],
          ]),
        },
      }),
      // Steps are a path somebody cannot ride or push a pram up, and the
      // data says so. Short ticks rather than dashes.
      layer('path-steps', 'line', 'transportation', {
        filter: ['==', ['get', 'subclass'], 'steps'],
        minzoom: 14,
        paint: {
          'line-color': PATH,
          'line-dasharray': [0.6, 0.6],
          'line-width': byZoom([
            [14, 3],
            [17, 6],
          ]),
        },
      }),

      // -------------------------------------------------------- boundaries --

      layer('boundary', 'line', 'boundary', {
        filter: ['<=', ['get', 'admin_level'], 4],
        paint: {
          'line-color': '#9a9080',
          'line-dasharray': [4, 2],
          'line-width': byZoom([
            [6, 0.6],
            [12, 1.6],
          ]),
        },
      }),

      // -------------------------------------------------------- the labels --
      // Everything above this point is shape. None of it says where you are.

      // Peaks, with the height under the name. In the Sierras that number
      // is how somebody tells one summit from the next.
      layer('peak-dot', 'circle', 'mountain_peak', {
        minzoom: 10,
        paint: {
          'circle-radius': 3,
          'circle-color': INK,
          'circle-stroke-width': 1.5,
          'circle-stroke-color': HALO,
        },
      }),
      layer('peak-label', 'symbol', 'mountain_peak', {
        minzoom: 11,
        layout: {
          'text-field': [
            'case',
            ['has', 'ele'],
            ['concat', NAME, '\n', ['to-string', ['round', ['get', 'ele']]], ' m'],
            NAME,
          ],
          'text-font': BOLD,
          'text-size': byZoom([
            [11, 10],
            [15, 13],
          ]),
          'text-offset': [0, 0.9],
          'text-anchor': 'top',
          'text-max-width': 8,
        },
        paint: {
          'text-color': INK,
          'text-halo-color': HALO,
          'text-halo-width': 1.6,
        },
      }),

      // Places, sized by how big they are. The rank field is what keeps a
      // hamlet from shouting as loudly as a city.
      layer('place-label', 'symbol', 'place', {
        filter: [
          'match',
          ['get', 'class'],
          ['city', 'town', 'village', 'hamlet', 'isolated_dwelling'],
          true,
          false,
        ],
        layout: {
          'text-field': NAME,
          'text-font': BOLD,
          // One zoom interpolation, with the size at each stop chosen by
          // what kind of place it is. The other way round, an interpolation
          // per class inside a match, is three zoom based subexpressions in
          // one property, and MapLibre allows exactly one: it refuses to
          // parse the whole style layer and says so only as a warning.
          'text-size': [
            'interpolate',
            ['linear'],
            ['zoom'],
            7,
            bySize(13, 10, 9),
            11,
            bySize(18, 13, 10),
            15,
            bySize(22, 16, 13),
          ],
          'text-max-width': 7,
        },
        paint: { 'text-color': INK, 'text-halo-color': HALO, 'text-halo-width': 1.8 },
      }),

      // Named water. A hiker refilling a bottle wants the name of the
      // stream, not just a blue line.
      layer('water-label', 'symbol', 'water_name', {
        minzoom: 12,
        layout: {
          'text-field': NAME,
          'text-font': REGULAR,
          'text-size': 11,
          'text-max-width': 7,
        },
        paint: { 'text-color': '#2f6d94', 'text-halo-color': HALO, 'text-halo-width': 1.4 },
      }),
      layer('waterway-label', 'symbol', 'waterway', {
        minzoom: 13,
        layout: {
          'text-field': NAME,
          'text-font': ['Noto Sans Regular'],
          'text-size': 10.5,
          'symbol-placement': 'line',
          'text-letter-spacing': 0.1,
        },
        paint: { 'text-color': '#2f6d94', 'text-halo-color': HALO, 'text-halo-width': 1.4 },
      }),

      // The name of the path, written along it, which is how a signposted
      // route is recognised.
      layer('path-label', 'symbol', 'transportation_name', {
        filter: ['match', ['get', 'class'], ['path', 'track'], true, false],
        minzoom: 13,
        layout: {
          'text-field': NAME,
          'text-font': REGULAR,
          'text-size': 11,
          'symbol-placement': 'line',
          'symbol-spacing': 220,
        },
        paint: { 'text-color': PATH, 'text-halo-color': HALO, 'text-halo-width': 1.6 },
      }),
      layer('road-label', 'symbol', 'transportation_name', {
        filter: [
          'match',
          ['get', 'class'],
          ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor'],
          true,
          false,
        ],
        minzoom: 13,
        layout: {
          'text-field': NAME,
          'text-font': REGULAR,
          'text-size': 10.5,
          'symbol-placement': 'line',
          'symbol-spacing': 260,
        },
        paint: { 'text-color': INK_SOFT, 'text-halo-color': HALO, 'text-halo-width': 1.4 },
      }),

      layer('park-label', 'symbol', 'park', {
        minzoom: 11,
        layout: {
          'text-field': NAME,
          'text-font': REGULAR,
          'text-size': 11.5,
          'text-max-width': 8,
        },
        paint: { 'text-color': '#4d7a42', 'text-halo-color': HALO, 'text-halo-width': 1.6 },
      }),

      // What a walker actually looks for. Filtered by the raw tag rather
      // than the derived class, because that is where shelters, springs and
      // viewpoints keep their identity.
      layer('poi-dot', 'circle', 'poi', {
        minzoom: 13,
        filter: [
          'match',
          ['get', 'subclass'],
          WHAT_A_WALKER_LOOKS_FOR,
          true,
          false,
        ],
        paint: {
          'circle-radius': 4,
          'circle-color': '#2f6d94',
          'circle-stroke-width': 1.5,
          'circle-stroke-color': HALO,
        },
      }),
      layer('poi-label', 'symbol', 'poi', {
        minzoom: 14,
        filter: [
          'match',
          ['get', 'subclass'],
          WORTH_NAMING,
          true,
          false,
        ],
        layout: {
          'text-field': NAME,
          'text-font': REGULAR,
          'text-size': 10.5,
          'text-offset': [0, 0.9],
          'text-anchor': 'top',
          'text-max-width': 7,
        },
        paint: { 'text-color': INK_SOFT, 'text-halo-color': HALO, 'text-halo-width': 1.4 },
      }),
    ],
  };
}

/** One layer of the document, with the source filled in. */
function layer(
  id: string,
  type: string,
  sourceLayer: string,
  rest: Record<string, unknown>,
): Record<string, unknown> {
  return { id, type, source: SOURCE, 'source-layer': sourceLayer, ...rest };
}

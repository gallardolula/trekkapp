/** Named offline regions and the tiles they contain.
 *
 *  The app downloads a named region rather than an arbitrary bounding box,
 *  which is what bounds the size of what a phone has to hold. See
 *  docs/adr/0006.
 *
 *  The listing is authenticated, because it is catalogue information. The
 *  style and the tiles themselves are not, for two reasons. They are
 *  OpenStreetMap derived data that the licence lets anyone redistribute,
 *  and the component that fetches them is MapLibre's own native
 *  downloader, which manages its requests outside the application's HTTP
 *  client and cannot be relied on to carry a bearer token on every one of
 *  the thousands of tiles a region comprises.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { FastifyInstance } from 'fastify';

import { config } from '../config';
import { describe, readTile, type RegionDefinition } from '../tiles/archive';

interface RegionsFile {
  regions: RegionDefinition[];
}

/**
 * The region definitions are a build artefact, not user data, so they live
 * beside the archives they describe instead of in the database.
 */
function definitions(): RegionDefinition[] {
  try {
    const raw = readFileSync(join(config.tilesDir, '..', 'regions.json'), 'utf8');
    return (JSON.parse(raw) as RegionsFile).regions;
  } catch {
    return [];
  }
}

/**
 * A MapLibre style that draws a legible hiking basemap.
 *
 * Built here rather than shipped in the app so that the tile addresses
 * match the server actually answering, which differs between a phone on
 * the local network and a deployment.
 */
function style(origin: string, region: RegionDefinition) {
  return {
    version: 8,
    name: region.name,
    sources: {
      trekkapp: {
        type: 'vector',
        tiles: [`${origin}/api/regions/${region.id}/tiles/{z}/{x}/{y}.pbf`],
        minzoom: region.minZoom,
        maxzoom: region.maxZoom,
        bounds: [region.bounds.west, region.bounds.south, region.bounds.east, region.bounds.north],
      },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#f3f1ea' } },
      {
        id: 'wood',
        type: 'fill',
        source: 'trekkapp',
        'source-layer': 'landcover',
        filter: ['in', 'class', 'wood', 'grass', 'scrub'],
        paint: { 'fill-color': '#dde6cf' },
      },
      {
        id: 'water',
        type: 'fill',
        source: 'trekkapp',
        'source-layer': 'water',
        paint: { 'fill-color': '#9fc3df' },
      },
      {
        id: 'waterway',
        type: 'line',
        source: 'trekkapp',
        'source-layer': 'waterway',
        paint: { 'line-color': '#9fc3df', 'line-width': 1.1 },
      },
      // Tracks and paths are drawn more prominently than roads. On this map
      // they are the subject, not a detail of the surroundings.
      {
        id: 'roads',
        type: 'line',
        source: 'trekkapp',
        'source-layer': 'transportation',
        filter: ['!in', 'class', 'path', 'track'],
        paint: { 'line-color': '#ffffff', 'line-width': 1.6 },
      },
      {
        id: 'paths',
        type: 'line',
        source: 'trekkapp',
        'source-layer': 'transportation',
        filter: ['in', 'class', 'path', 'track'],
        paint: {
          'line-color': '#b4702f',
          'line-width': 1.3,
          'line-dasharray': [2, 1.5],
        },
      },
      {
        id: 'peaks',
        type: 'circle',
        source: 'trekkapp',
        'source-layer': 'mountain_peak',
        paint: {
          'circle-radius': 3,
          'circle-color': '#6b4a2f',
          'circle-stroke-width': 1,
          'circle-stroke-color': '#ffffff',
        },
      },
    ],
  };
}

export async function regionRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/regions', { preHandler: [app.authenticate] }, async (_request, reply) => {
    const regions = definitions().map((r) => describe(config.tilesDir, r));
    return reply.send({ regions });
  });

  app.get<{ Params: { id: string } }>('/api/regions/:id/style.json', async (request, reply) => {
    const region = definitions().find((r) => r.id === request.params.id);
    if (!region) return reply.code(404).send({ error: 'not_found' });

    const forwarded = request.headers['x-forwarded-proto'];
    const protocol = typeof forwarded === 'string' ? forwarded : request.protocol;
    const origin = `${protocol}://${request.headers.host}`;

    return reply.send(style(origin, region));
  });

  app.get<{ Params: { id: string; z: string; x: string; y: string } }>(
    '/api/regions/:id/tiles/:z/:x/:y.pbf',
    async (request, reply) => {
      const z = Number(request.params.z);
      const x = Number(request.params.x);
      const y = Number(request.params.y);
      if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y)) {
        return reply.code(400).send({ error: 'invalid_tile' });
      }

      const tile = readTile(config.tilesDir, request.params.id, z, x, y);
      // An absent tile is normal, not an error: a region is a rectangle and
      // much of it holds nothing worth drawing. MapLibre expects 204.
      if (!tile) return reply.code(204).send();

      return reply
        .header('content-type', 'application/x-protobuf')
        // Planetiler stores vector tiles already compressed.
        .header('content-encoding', 'gzip')
        // The archive is versioned by regeneration, so a tile is immutable
        // for as long as the region keeps its version.
        .header('cache-control', 'public, max-age=604800, immutable')
        .send(Buffer.from(tile));
    },
  );
}

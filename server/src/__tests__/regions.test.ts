/** Serving offline regions and their tiles.
 *
 *  Runs against a real MBTiles archive built in the test itself rather
 *  than the generated one, so the suite does not depend on a twelve
 *  megabyte artefact being present.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { gzipSync } from 'node:zlib';

import type { FastifyInstance } from 'fastify';

import { closeArchives, describe as describeRegion, readTile } from '../tiles/archive';

jest.setTimeout(60_000);

let directory: string;

const REGION = {
  id: 'prueba',
  name: 'Región de prueba',
  description: 'Sólo para las pruebas.',
  bounds: { west: -65, south: -32, east: -64, north: -31 },
  minZoom: 6,
  maxZoom: 14,
};

// A real tile, gzipped, as Planetiler stores them.
const TILE = gzipSync(Buffer.from('contenido de la baldosa'));

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), 'trekkapp-tiles-'));
  const db = new DatabaseSync(join(directory, 'prueba.mbtiles'));
  db.exec(`
    CREATE TABLE metadata (name TEXT, value TEXT);
    CREATE TABLE tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB);
  `);
  // At zoom 2 the vertical axis spans 0 to 3, so the TMS row of y=1 is 2.
  db.prepare('INSERT INTO tiles VALUES (?, ?, ?, ?)').run(2, 1, 2, TILE);
  db.close();

  writeFileSync(join(directory, '..', 'regions.json'), JSON.stringify({ regions: [REGION] }));
});

afterAll(() => {
  closeArchives();
  rmSync(directory, { recursive: true, force: true });
});

describe('reading an archive', () => {
  it('reports a region that has an archive as available', () => {
    const status = describeRegion(directory, REGION);
    expect(status.available).toBe(true);
    expect(status.tileCount).toBe(1);
    expect(status.sizeBytes).toBeGreaterThan(0);
  });

  it('reports a region with no archive as unavailable instead of failing', () => {
    const status = describeRegion(directory, { ...REGION, id: 'inexistente' });
    expect(status.available).toBe(false);
    expect(status.tileCount).toBe(0);
    expect(status.version).toBe('none');
  });

  it('gives a version that changes when the archive is regenerated', () => {
    const first = describeRegion(directory, REGION);
    const db = new DatabaseSync(join(directory, 'prueba.mbtiles'));
    db.prepare('INSERT INTO tiles VALUES (?, ?, ?, ?)').run(3, 1, 1, TILE);
    db.close();
    closeArchives();
    expect(describeRegion(directory, REGION).version).not.toBe(first.version);
  });
});

describe('reading a tile', () => {
  it('flips the vertical axis from the scheme MBTiles uses', () => {
    // MBTiles counts rows from the bottom and every map client counts them
    // from the top. Getting this wrong returns a tile from the wrong place
    // rather than an error, which is why it is pinned here.
    expect(readTile(directory, 'prueba', 2, 1, 1)).not.toBeNull();
    expect(readTile(directory, 'prueba', 2, 1, 2)).toBeNull();
  });

  it('returns the stored bytes untouched, still compressed', () => {
    const tile = readTile(directory, 'prueba', 2, 1, 1)!;
    expect(Buffer.from(tile)[0]).toBe(0x1f);
    expect(Buffer.from(tile)[1]).toBe(0x8b);
  });

  it('returns null for a tile the archive does not hold', () => {
    expect(readTile(directory, 'prueba', 10, 1, 1)).toBeNull();
  });

  it('returns null for an archive that does not exist', () => {
    expect(readTile(directory, 'inexistente', 2, 1, 1)).toBeNull();
  });
});

describe('the endpoints', () => {
  let app: FastifyInstance;
  let token: string;

  beforeAll(async () => {
    process.env['TILES_DIR'] = directory;
    jest.resetModules();
    const { buildApp } = await import('../app');
    const { pool } = await import('../db/pool');
    const { readFileSync } = await import('node:fs');
    const sql = readFileSync(join(__dirname, '..', 'db', 'migrations', '001_initial.sql'), 'utf8');
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await pool.query(sql);

    app = buildApp();
    await app.ready();
    const registered = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        name: 'Mapa',
        email: `regions.${Date.now()}@example.test`,
        password: 'Sierras2026!',
        level: 'beginner',
      },
    });
    token = registered.json().accessToken;
  });

  afterAll(async () => {
    await app.close();
    const { pool } = await import('../db/pool');
    await pool.end();
  });

  it('refuses the listing without a session', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/regions' });
    expect(response.statusCode).toBe(401);
  });

  it('lists the region with its size and tile count', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/regions',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().regions[0].id).toBe('prueba');
    expect(response.json().regions[0].available).toBe(true);
  });

  it('serves the style without a session, because MapLibre fetches it itself', async () => {
    // The native downloader manages its own requests and cannot be relied
    // on to carry a bearer token on every one of thousands of tiles.
    const response = await app.inject({ method: 'GET', url: '/api/regions/prueba/style.json' });
    expect(response.statusCode).toBe(200);
    expect(response.json().sources.trekkapp.tiles[0]).toContain('/tiles/{z}/{x}/{y}.pbf');
  });

  it('answers 404 for the style of an unknown region', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/regions/nada/style.json' });
    expect(response.statusCode).toBe(404);
  });

  it('serves a tile with the headers a vector client needs', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/regions/prueba/tiles/2/1/1.pbf' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('application/x-protobuf');
    expect(response.headers['content-encoding']).toBe('gzip');
  });

  it('answers 204 for an empty tile rather than an error', async () => {
    // Much of any rectangular region holds nothing worth drawing, so an
    // absent tile is the normal case and not a failure.
    const response = await app.inject({
      method: 'GET',
      url: '/api/regions/prueba/tiles/9/1/1.pbf',
    });
    expect(response.statusCode).toBe(204);
  });

  it('rejects a tile address that is not numeric', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/regions/prueba/tiles/x/1/1.pbf',
    });
    expect(response.statusCode).toBe(400);
  });
});

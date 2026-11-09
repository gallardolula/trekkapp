/** Serving the glyphs the labels are drawn with.
 *
 *  The behaviour worth pinning here is the one that is not obvious: a range
 *  this server does not hold answers with an empty glyph stack and not with
 *  a 404. The offline downloader asks for all two hundred and fifty six
 *  ranges of every font stack in the style, because it cannot know which
 *  characters a tile it has not read yet will need, and one failed resource
 *  fails the entire download. Refusing those ranges made the region refuse
 *  to download at all, and blame the connection while doing it.
 */
import type { FastifyInstance } from 'fastify';

import { buildApp } from '../app';

let app: FastifyInstance;

beforeAll(async () => {
  app = buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

const get = (path: string) => app.inject({ method: 'GET', url: path });

describe('a range the server holds', () => {
  it('serves the real glyphs', async () => {
    const response = await get('/fonts/Noto%20Sans%20Regular/0-255.pbf');
    expect(response.statusCode).toBe(200);
    expect(response.rawPayload.length).toBeGreaterThan(10_000);
    expect(response.headers['content-type']).toBe('application/x-protobuf');
  });

  it('serves the bold face as its own stack', async () => {
    const regular = await get('/fonts/Noto%20Sans%20Regular/0-255.pbf');
    const bold = await get('/fonts/Noto%20Sans%20Bold/0-255.pbf');
    expect(bold.statusCode).toBe(200);
    expect(bold.rawPayload.equals(regular.rawPayload)).toBe(false);
  });

  it('honours the first face of a stack that it has', async () => {
    // A style may name several faces in order of preference. Answering
    // with one held rather than failing keeps the labels drawn.
    const response = await get('/fonts/Helvetica,Noto%20Sans%20Bold/0-255.pbf');
    expect(response.statusCode).toBe(200);
    expect(response.rawPayload.length).toBeGreaterThan(10_000);
  });
});

describe('a range the server does not hold', () => {
  it('answers, rather than refusing', async () => {
    const response = await get('/fonts/Noto%20Sans%20Regular/65280-65535.pbf');
    expect(response.statusCode).toBe(200);
  });

  it('answers with a glyph stack that simply has no glyphs in it', async () => {
    const response = await get('/fonts/Noto%20Sans%20Regular/1024-1279.pbf');
    const body = response.rawPayload;

    // glyphs { stacks: [ fontstack { name, range } ] }, so: field 1 as a
    // length delimited message, holding the two strings and nothing else.
    expect(body[0]).toBe(0x0a);
    expect(body.length).toBe(body[1]! + 2);
    expect(body.toString('utf8')).toContain('Noto Sans Regular');
    expect(body.toString('utf8')).toContain('1024-1279');
  });

  it('answers every range the offline downloader will ask for', async () => {
    // All of them, every time, or the download fails on the first refusal.
    for (let start = 0; start < 65536; start += 256) {
      const response = await get(`/fonts/Noto%20Sans%20Regular/${start}-${start + 255}.pbf`);
      expect(response.statusCode).toBe(200);
      expect(response.rawPayload.length).toBeGreaterThan(0);
    }
  });
});

describe('a request that is not a range', () => {
  it('refuses anything that is not two numbers joined by a dash', async () => {
    expect((await get('/fonts/Noto%20Sans%20Regular/nonsense.pbf')).statusCode).toBe(400);
  });

  it('never lets a range reach outside the glyph directory', async () => {
    // The range builds a path, so it is checked against its exact shape
    // rather than sanitised.
    const response = await get('/fonts/Noto%20Sans%20Regular/..%2F..%2Fpackage.json');
    expect(response.statusCode).toBe(404);
  });
});

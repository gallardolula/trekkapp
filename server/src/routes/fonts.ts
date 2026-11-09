/** Serving the glyphs the map draws its labels with.
 *
 *  A vector map carries no text. It carries where the names go and what
 *  they say, and the shapes of the letters have to come from somewhere
 *  else. MapLibre asks for them as signed distance fields, in ranges of
 *  256 code points, and renders nothing at all when it cannot get them,
 *  which is why the map had no labels: the style never declared where to
 *  ask.
 *
 *  Served from this server like everything else, so the offline downloader
 *  packs them along with the tiles and a phone in the mountains has the
 *  letters it needs. Two ranges are held, which between them cover Spanish
 *  and every accent in the place names of the Sierras.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, normalize } from 'node:path';

import type { FastifyInstance } from 'fastify';

/** Where the glyph files live, next to the server rather than in the tiles. */
const DIRECTORY = join(__dirname, '..', '..', 'fonts');

/** The faces held. A stack naming anything else falls back to the first. */
const AVAILABLE = ['Noto Sans Regular', 'Noto Sans Bold'];

const cache = new Map<string, Buffer>();

/**
 * An empty but valid answer, for a range this server does not hold.
 *
 * It cannot be a 404. The offline downloader asks for all two hundred and
 * fifty six ranges of every font stack in the style, because it has no way
 * of knowing which characters a tile it has not read yet will need, and a
 * single failed resource fails the whole download. The region simply
 * refused to download, blaming the connection.
 *
 * So every range answers, and the ones with no letters in them answer with
 * a glyph stack that contains none. Encoded by hand because it is four
 * fields of protobuf and pulling in an encoder to write them would be the
 * larger dependency.
 *
 *   glyphs   { stacks: [ fontstack ] }   field 1, length delimited
 *   fontstack { name: string, range: string, glyphs: [] }
 */
function emptyStack(face: string, range: string): Buffer {
  const name = Buffer.from(face, 'utf8');
  const span = Buffer.from(range, 'utf8');

  // Field 1 of fontstack is the name, field 2 the range. Both are strings,
  // so wire type 2: the tag is (field << 3) | 2.
  const stack = Buffer.concat([
    Buffer.from([0x0a, name.length]),
    name,
    Buffer.from([0x12, span.length]),
    span,
  ]);

  return Buffer.concat([Buffer.from([0x0a, stack.length]), stack]);
}

/**
 * Resolves a font stack to a face on disk.
 *
 * A style names a stack, a list of preferences, and the client sends it
 * comma separated. Honouring the first one held rather than failing means
 * a style written against a richer server still draws its labels here.
 */
function resolve(stack: string): string | null {
  const wanted = stack.split(',').map((f) => f.trim());
  return wanted.find((f) => AVAILABLE.includes(f)) ?? AVAILABLE[0] ?? null;
}

export async function fontRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { stack: string; range: string } }>(
    '/fonts/:stack/:range.pbf',
    async (request, reply) => {
      // The range comes from the URL and is used to build a path, so it is
      // checked against its exact shape rather than sanitised. Anything
      // that is not two numbers joined by a dash never reaches the disk.
      if (!/^\d{1,5}-\d{1,5}$/.test(request.params.range)) {
        return reply.code(400).send({ error: 'invalid_range' });
      }

      const face = resolve(decodeURIComponent(request.params.stack));
      if (!face) return reply.code(404).send({ error: 'not_found' });

      const key = `${face}/${request.params.range}`;
      let glyphs = cache.get(key);

      if (!glyphs) {
        const path = normalize(join(DIRECTORY, face, `${request.params.range}.pbf`));
        glyphs =
          path.startsWith(DIRECTORY) && existsSync(path)
            ? readFileSync(path)
            : emptyStack(face, request.params.range);
        cache.set(key, glyphs);
      }

      return reply
        .header('content-type', 'application/x-protobuf')
        // The glyphs never change, so a phone that has them never asks again.
        .header('cache-control', 'public, max-age=31536000, immutable')
        .send(glyphs);
    },
  );
}

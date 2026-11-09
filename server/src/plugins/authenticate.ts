/** Authentication for routes.
 *
 *  Exposes one guard as a Fastify decorator. `authenticate` establishes who
 *  is calling, and that is the whole of it: there is a single kind of
 *  account, so there is nothing to authorise beyond being signed in.
 *
 *  It used to expose a second guard for the moderator role. That went with
 *  the review queue, which no person could work and which promised a
 *  verification it had no way to perform.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import { readAccessToken } from '../auth/tokens';

declare module 'fastify' {
  interface FastifyRequest {
    user?: { id: string };
  }
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

function bearer(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

async function plugin(app: FastifyInstance): Promise<void> {
  app.decorateRequest('user', undefined);

  app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    const token = bearer(request);
    const claims = token ? await readAccessToken(token) : null;
    if (!claims) {
      // The reason is deliberately not narrowed. Telling a caller whether a
      // token is unknown, altered or merely expired helps nobody but an
      // attacker probing for valid ones.
      await reply.code(401).send({ error: 'unauthenticated' });
      return;
    }
    request.user = { id: claims.userId };
  });
}

export const authenticatePlugin = fp(plugin, { name: 'authenticate' });

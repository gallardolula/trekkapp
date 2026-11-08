/** Authentication and authorisation for routes.
 *
 *  Exposes two guards as Fastify decorators. `authenticate` establishes who
 *  is calling. `requireModerator` additionally checks the role, and is the
 *  single place where that check lives, so a moderation route cannot be
 *  added without it.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import { readAccessToken, type Role } from '../auth/tokens';

declare module 'fastify' {
  interface FastifyRequest {
    user?: { id: string; role: Role };
  }
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireModerator: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
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
    request.user = { id: claims.userId, role: claims.role };
  });

  // Not delegating to `authenticate` here: knowing whether that guard
  // already answered would mean inspecting the reply, and Fastify 5 no
  // longer exposes that. Resolving the token once is clearer anyway.
  app.decorate('requireModerator', async (request: FastifyRequest, reply: FastifyReply) => {
    const token = bearer(request);
    const claims = token ? await readAccessToken(token) : null;
    if (!claims) {
      await reply.code(401).send({ error: 'unauthenticated' });
      return;
    }
    if (claims.role !== 'moderator') {
      await reply.code(403).send({ error: 'forbidden' });
      return;
    }
    request.user = { id: claims.userId, role: claims.role };
  });
}

export const authenticatePlugin = fp(plugin, { name: 'authenticate' });

/** Builds the Fastify instance.
 *
 *  Kept apart from the bootstrap so the tests can build a server, exercise
 *  it through `inject` and never open a port.
 */
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';

import { authenticatePlugin } from './plugins/authenticate';
import { authRoutes } from './routes/auth';
import { forecastRoutes } from './routes/forecast';
import { regionRoutes } from './routes/regions';
import { reportRoutes } from './routes/reports';
import { trailRoutes } from './routes/trails';

export function buildApp(options: { logger?: boolean } = {}): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? false,
    // A track of fifty thousand points is a legitimate upload and exceeds
    // the default limit of one megabyte.
    bodyLimit: 20 * 1024 * 1024,
  });

  app.register(authenticatePlugin);
  app.register(authRoutes);
  app.register(trailRoutes);
  app.register(reportRoutes);
  app.register(forecastRoutes);
  app.register(regionRoutes);

  app.get('/health', async () => ({ status: 'ok' }));

  app.setErrorHandler((error: FastifyError, request, reply) => {
    request.log.error(error);
    // The message is deliberately generic. An internal failure should not
    // describe the schema or the query that produced it.
    reply.code(error.statusCode ?? 500).send({
      error: error.statusCode && error.statusCode < 500 ? error.message : 'internal_error',
    });
  });

  return app;
}

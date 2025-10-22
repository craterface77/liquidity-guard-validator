import type { FastifyInstance } from 'fastify';
import { riskRoutes } from './risk';
import { claimRoutes } from './claims';
import { healthRoutes } from './health';
import { metricsRoutes } from './metrics';

export async function registerRoutes(app: FastifyInstance) {
  await app.register(healthRoutes);
  await app.register(metricsRoutes, { prefix: '/validator/api/v1' });
  await app.register(riskRoutes, { prefix: '/validator/api/v1' });
  await app.register(claimRoutes, { prefix: '/validator/api/v1' });
}

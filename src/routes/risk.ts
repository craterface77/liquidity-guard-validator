import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import fp from 'fastify-plugin';
import { z } from 'zod';
import { getRiskDetail, listRisks } from '../services/riskService';

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().optional(),
});

async function riskPlugin(app: FastifyInstance, _opts: FastifyPluginOptions) {
  app.get('/risk', async (request, reply) => {
    const query = listQuerySchema.parse(request.query);
    const params: { limit: number; cursor?: string } = { limit: query.limit };
    if (query.cursor !== undefined) {
      params.cursor = query.cursor;
    }
    const data = await listRisks(params);
    return reply.send(data);
  });

  app.get('/risk/:riskId', async (request, reply) => {
    const params = z.object({ riskId: z.string() }).parse(request.params);
    const detail = await getRiskDetail(params.riskId);
    if (!detail) {
      return reply.status(404).send({ error: 'risk_not_found' });
    }
    return reply.send(detail);
  });
}

export const riskRoutes = fp(riskPlugin);

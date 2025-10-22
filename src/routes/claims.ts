import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import fp from 'fastify-plugin';
import crypto from 'crypto';
import { env } from '../config/env';
import { previewClaim, signClaim } from '../services/claimService';

async function ensureSignature(request: any, reply: any) {
  if (!env.VALIDATOR_API_SECRET) {
    return;
  }

  const signature = request.headers['x-lg-signature'];
  const timestamp = request.headers['x-lg-timestamp'];

  if (typeof signature !== 'string' || typeof timestamp !== 'string') {
    return reply.code(401).send({ error: 'unauthorized' });
  }

  const payload = `${timestamp}.${JSON.stringify(request.body ?? {})}`;
  const expected = crypto
    .createHmac('sha256', env.VALIDATOR_API_SECRET)
    .update(payload)
    .digest('hex');

  if (expected !== signature) {
    return reply.code(401).send({ error: 'unauthorized' });
  }
}

async function claimsPlugin(app: FastifyInstance, _opts: FastifyPluginOptions) {
  app.post('/claims/preview', { preHandler: ensureSignature }, async (request, reply) => {
    const result = await previewClaim(request.body);
    return reply.send(result);
  });

  app.post('/claims/sign', { preHandler: ensureSignature }, async (request, reply) => {
    const result = await signClaim(request.body);
    return reply.send(result);
  });
}

export const claimRoutes = fp(claimsPlugin);

import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import fp from 'fastify-plugin';
import { clickhouseQuery } from '../db/clickhouse';
import { env } from '../config/env';

async function healthPlugin(app: FastifyInstance, _opts: FastifyPluginOptions) {
  app.get('/', async () => {
    try {
      await clickhouseQuery({ query: 'SELECT 1' });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  });

  app.get('/health', async (request, reply) => {
    try {
      // Check ClickHouse connectivity
      await clickhouseQuery({ query: 'SELECT 1' });

      // Get latest sample
      const [latestSample] = await clickhouseQuery<{
        ts: string;
        block_number: number;
        r_bps: number;
        loss_quote_bps: number;
        price: number;
      }>({
        query: `
          SELECT ts, block_number, r_bps, loss_quote_bps, price
          FROM liquidityguard.pool_samples
          WHERE pool_id = {poolId:String}
          ORDER BY ts DESC
          LIMIT 1
        `,
        params: { poolId: env.POOL_ID },
      });

      // Get active depeg events
      const activeEvents = await clickhouseQuery<{
        risk_id: string;
        window_start: string;
        r_bps: number;
        severity_bps: number;
      }>({
        query: `
          SELECT risk_id, window_start, r_bps, severity_bps
          FROM liquidityguard.risk_events FINAL
          WHERE pool_id = {poolId:String} AND risk_state = 'OPEN'
          ORDER BY window_start DESC
        `,
        params: { poolId: env.POOL_ID },
      });

      // Get total samples count
      const [stats] = await clickhouseQuery<{
        total_samples: number;
        first_sample: string | null;
        last_sample: string | null;
      }>({
        query: `
          SELECT
            count() as total_samples,
            min(ts) as first_sample,
            max(ts) as last_sample
          FROM liquidityguard.pool_samples
          WHERE pool_id = {poolId:String}
        `,
        params: { poolId: env.POOL_ID },
      });

      const now = Date.now();
      const lastSampleAge = latestSample ? now - new Date(latestSample.ts).getTime() : null;
      const isHealthy = lastSampleAge ? lastSampleAge < 5 * 60 * 1000 : false; // 5 minutes

      return reply.send({
        status: isHealthy ? 'healthy' : 'stale',
        timestamp: new Date().toISOString(),
        config: {
          poolId: env.POOL_ID,
          poolAddress: env.POOL_ADDRESS,
          chainId: env.CHAIN_ID,
          rMinBps: env.R_MIN_BPS,
          gracePeriodSeconds: env.GRACE_PERIOD_SECONDS,
        },
        latestSample: latestSample
          ? {
              timestamp: latestSample.ts,
              block: latestSample.block_number,
              rBps: latestSample.r_bps,
              lossQuoteBps: latestSample.loss_quote_bps,
              price: latestSample.price,
              ageMs: lastSampleAge,
            }
          : null,
        activeEvents: activeEvents.map((e) => ({
          riskId: e.risk_id,
          start: e.window_start,
          rBps: e.r_bps,
          severityBps: e.severity_bps,
        })),
        statistics: {
          totalSamples: stats?.total_samples || 0,
          firstSample: stats?.first_sample || null,
          lastSample: stats?.last_sample || null,
        },
      });
    } catch (error) {
      return reply.status(503).send({
        status: 'error',
        error: (error as Error).message,
      });
    }
  });
}

export const healthRoutes = fp(healthPlugin);

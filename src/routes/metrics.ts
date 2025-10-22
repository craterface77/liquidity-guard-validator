import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import fp from 'fastify-plugin';
import { z } from 'zod';
import { clickhouseQuery } from '../db/clickhouse';
import { env } from '../config/env';

const metricsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(10000).default(1000),
  from: z.coerce.number().int().optional(),
  to: z.coerce.number().int().optional(),
});

async function metricsPlugin(app: FastifyInstance, _opts: FastifyPluginOptions) {
  app.get('/metrics', async (request, reply) => {
    const query = metricsQuerySchema.parse(request.query);

    const fromCondition = query.from
      ? `AND ts >= toDateTime64({from:UInt64}, 3)`
      : '';
    const toCondition = query.to ? `AND ts <= toDateTime64({to:UInt64}, 3)` : '';

    const samples = await clickhouseQuery<{
      ts: string;
      block_number: number;
      reserve_base: number;
      reserve_quote: number;
      total_lp_supply: number;
      price: number;
      r_bps: number;
      loss_quote_bps: number;
      twap_bps: number;
    }>({
      query: `
        SELECT
          ts,
          block_number,
          reserve_base,
          reserve_quote,
          total_lp_supply,
          price,
          r_bps,
          loss_quote_bps,
          twap_bps
        FROM liquidityguard.pool_samples
        WHERE pool_id = {poolId:String}
          ${fromCondition}
          ${toCondition}
        ORDER BY ts DESC
        LIMIT {limit:UInt32}
      `,
      params: {
        poolId: env.POOL_ID,
        limit: query.limit,
        from: query.from,
        to: query.to,
      },
    });

    return reply.send({
      poolId: env.POOL_ID,
      count: samples.length,
      samples: samples.map((s) => ({
        timestamp: s.ts,
        block: s.block_number,
        reserves: {
          base: s.reserve_base,
          quote: s.reserve_quote,
          totalSupply: s.total_lp_supply,
        },
        price: s.price,
        rBps: s.r_bps,
        lossQuoteBps: s.loss_quote_bps,
        twapBps: s.twap_bps,
      })),
    });
  });

  app.get('/metrics/chart', async (request, reply) => {
    const query = metricsQuerySchema.parse(request.query);

    const fromCondition = query.from
      ? `AND ts >= toDateTime64({from:UInt64}, 3)`
      : '';
    const toCondition = query.to ? `AND ts <= toDateTime64({to:UInt64}, 3)` : '';

    const samples = await clickhouseQuery<{
      ts: string;
      r_bps: number;
      loss_quote_bps: number;
      price: number;
      reserve_base: number;
      reserve_quote: number;
    }>({
      query: `
        SELECT
          ts,
          r_bps,
          loss_quote_bps,
          price,
          reserve_base,
          reserve_quote
        FROM liquidityguard.pool_samples
        WHERE pool_id = {poolId:String}
          ${fromCondition}
          ${toCondition}
        ORDER BY ts ASC
        LIMIT {limit:UInt32}
      `,
      params: {
        poolId: env.POOL_ID,
        limit: query.limit,
        from: query.from,
        to: query.to,
      },
    });

    const timestamps = samples.map((s) => s.ts);
    const rBpsValues = samples.map((s) => s.r_bps);
    const lossValues = samples.map((s) => s.loss_quote_bps);
    const priceValues = samples.map((s) => s.price);
    const baseReserves = samples.map((s) => s.reserve_base);
    const quoteReserves = samples.map((s) => s.reserve_quote);

    return reply.send({
      poolId: env.POOL_ID,
      thresholds: {
        rMinBps: env.R_MIN_BPS,
        gracePeriodSeconds: env.GRACE_PERIOD_SECONDS,
      },
      data: {
        timestamps,
        rBps: rBpsValues,
        lossQuoteBps: lossValues,
        price: priceValues,
        reserves: {
          base: baseReserves,
          quote: quoteReserves,
        },
      },
    });
  });
}

export const metricsRoutes = fp(metricsPlugin);

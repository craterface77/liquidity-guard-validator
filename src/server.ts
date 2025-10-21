import Fastify from 'fastify';
import cors from '@fastify/cors';
import { createClient } from '@clickhouse/client';
import { z } from 'zod';

const fastify = Fastify({ logger: true });
await fastify.register(cors, { origin: true });

const CLICKHOUSE_URL = process.env.CLICKHOUSE_URL ?? 'http://localhost:8123';
const clickhouse = createClient({ url: CLICKHOUSE_URL });

const parseIntSafe = (v: any, fallback = 0) => (v == null ? fallback : parseInt(v, 10));

fastify.get('/validator/api/v1/risk', async (req, reply) => {
  const q = z.object({ limit: z.string().optional(), from: z.string().optional() }).parse(req.query);
  const limit = parseIntSafe(q.limit, 50);
  const fromClause = q.from ? `AND e.window_start >= parseDateTimeBestEffort('${q.from}')` : '';

  const sql = `
    SELECT
      e.risk_id,
      e.pool_id,
      e.chain_id,
      e.risk_state,
      e.window_start,
      e.window_end,
      e.severity_bps,
      e.twap_bps,
      e.r_bps,
      e.attested_at,
      e.attestor,
      (SELECT min(r_bps) FROM liquidityguard.pool_samples ps WHERE ps.pool_id = e.pool_id AND ps.ts BETWEEN e.window_start AND if(e.window_end=toDateTime64('0000-01-01 00:00:00',3), now(), e.window_end)) AS min_r_bps,
      (SELECT max(loss_quote_bps) FROM liquidityguard.pool_samples ps WHERE ps.pool_id = e.pool_id AND ps.ts BETWEEN e.window_start AND if(e.window_end=toDateTime64('0000-01-01 00:00:00',3), now(), e.window_end)) AS max_loss_bps,
      (SELECT avg(twap_bps) FROM liquidityguard.pool_samples ps WHERE ps.pool_id = e.pool_id AND ps.ts BETWEEN e.window_start AND if(e.window_end=toDateTime64('0000-01-01 00:00:00',3), now(), e.window_end)) AS avg_twap_bps,
      (SELECT count() FROM liquidityguard.pool_samples ps WHERE ps.pool_id = e.pool_id AND ps.ts BETWEEN e.window_start AND if(e.window_end=toDateTime64('0000-01-01 00:00:00',3), now(), e.window_end)) AS sample_count
    FROM liquidityguard.risk_events e
    WHERE 1=1 ${fromClause}
    ORDER BY e.attested_at DESC
    LIMIT ${limit}
  `;

  const result = await clickhouse.query({ query: sql, format: 'JSONEachRow' });
  const rows: any[] = [];
  for await (const row of result.jsonEachRow()) rows.push(row);
  return reply.send({ count: rows.length, items: rows });
});

fastify.get('/validator/api/v1/risk/:riskId', async (req, reply) => {
  const params = z.object({ riskId: z.string() }).parse(req.params);
  const id = params.riskId.replace("'", "");

  const rsql = `SELECT * FROM liquidityguard.risk_events WHERE risk_id = '${id}' LIMIT 1`;
  const rres = await clickhouse.query({ query: rsql, format: 'JSONEachRow' });
  const rrows: any[] = [];
  for await (const r of rres.jsonEachRow()) rrows.push(r);
  if (rrows.length === 0) return reply.status(404).send({ error: 'not_found' });
  const event = rrows[0];

  const windowEndExpr = event.window_end ? `parseDateTimeBestEffort('${event.window_end}')` : 'now()';

  const aggSql = `
    SELECT
      min(r_bps) AS min_r_bps,
      max(loss_quote_bps) AS max_loss_bps,
      avg(twap_bps) AS avg_twap_bps,
      quantile(0.5)(loss_quote_bps) AS median_loss_bps,
      count() AS sample_count
    FROM liquidityguard.pool_samples
    WHERE pool_id = '${event.pool_id}'
      AND ts BETWEEN parseDateTimeBestEffort('${event.window_start}') AND ${windowEndExpr}
  `;

  const aggRes = await clickhouse.query({ query: aggSql, format: 'JSONEachRow' });
  const aggRows: any[] = [];
  for await (const a of aggRes.jsonEachRow()) aggRows.push(a);
  const agg = aggRows[0] ?? {};

  const seriesSql = `
    SELECT
      toStartOfInterval(ts, INTERVAL 1 minute) AS t_min,
      avg(r_bps) AS avg_r_bps,
      avg(twap_bps) AS avg_twap_bps,
      avg(loss_quote_bps) AS avg_loss_bps,
      count() AS samples
    FROM liquidityguard.pool_samples
    WHERE pool_id = '${event.pool_id}'
      AND ts BETWEEN parseDateTimeBestEffort('${event.window_start}') AND ${windowEndExpr}
    GROUP BY t_min
    ORDER BY t_min ASC
    LIMIT 5000
  `;

  const sres = await clickhouse.query({ query: seriesSql, format: 'JSONEachRow' });
  const series: any[] = [];
  for await (const s of sres.jsonEachRow()) series.push(s);

  return reply.send({ event, aggregates: agg, series });
});

const start = async () => {
  try {
    await fastify.listen({ port: Number(process.env.PORT ?? 3000), host: '0.0.0.0' });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();

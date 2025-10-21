import { createClient } from '@clickhouse/client';

const CLICKHOUSE_URL = process.env.CLICKHOUSE_URL ?? 'http://localhost:8123';
const client = createClient({ url: CLICKHOUSE_URL });

async function run() {
  // small synthetic dataset
  const poolId = 'curve:0xDEMOPOOL';
  const now = new Date();
  const rows: any[] = [];
  for (let i = 0; i < 60; i++) {
    const ts = new Date(now.getTime() - (60 - i) * 1000 * 30); // every 30s
    rows.push({
      ts: ts.toISOString().replace('Z',''),
      pool_id: poolId,
      chain_id: 1,
      reserve_usdc: 1000000000,
      reserve_partner: 1000000000,
      total_lp_supply: 1000000000000,
      twap_bps: 10000 + Math.round(Math.sin(i/5) * 50),
      loss_quote_bps: 100 + Math.round(Math.abs(Math.sin(i/7)) * 50),
      r_bps: 5000 + Math.round(Math.cos(i/6) * 300),
      sample_source: 'seed-generator',
      tags: ['demo']
    });
  }

  // insert samples
  await client.insert({ table: 'liquidityguard.pool_samples', format: 'JSONEachRow', values: rows });

  // insert a canonical risk event
  const start = new Date(now.getTime() - 30 * 60 * 1000).toISOString().replace('Z','');
  const end = new Date(now.getTime() + 5 * 60 * 1000).toISOString().replace('Z','');
  const event = [{
    risk_id: `${poolId}|${Math.floor(now.getTime()/1000)}`,
    pool_id: poolId,
    chain_id: 1,
    window_start: start,
    window_end: end,
    risk_state: 'Yellow',
    severity_bps: 120,
    twap_bps: 9950,
    r_bps: 4800,
    attested_at: now.toISOString().replace('Z',''),
    attestor: '0xSEED',
    snapshot_cid: '',
    meta: '{}'
  }];

  await client.insert({ table: 'liquidityguard.risk_events', format: 'JSONEachRow', values: event });

  console.log('Seed complete.');
}

run().catch(err => { console.error(err); process.exit(1); })

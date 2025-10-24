import { createClient } from "@clickhouse/client";
import { addMinutes } from "date-fns";
import { randomUUID } from "crypto";
import * as dotenv from "dotenv";

dotenv.config();

const CLICKHOUSE_URL = process.env.CLICKHOUSE_URL ?? "http://localhost:8123";
const CLICKHOUSE_USER = process.env.CLICKHOUSE_USER ?? "default";
const CLICKHOUSE_PASSWORD = process.env.CLICKHOUSE_PASSWORD ?? "";

async function seed() {
  const client = createClient({
    url: CLICKHOUSE_URL,
    username: CLICKHOUSE_USER,
    password: CLICKHOUSE_PASSWORD,
    database: "liquidityguard",
  });

  const poolId = "curve:0xDEMOPOOL";
  const chainId = 1;
  const now = new Date();
  const rows: any[] = [];

  for (let i = 0; i < 120; i++) {
    const ts = addMinutes(now, -120 + i);
    const rBps = 5000 + Math.round(Math.sin(i / 8) * 400);
    const lossQuoteBps = Math.max(0, Math.round(Math.sin(i / 6) * 120));
    const twapBps = 10000 + Math.round(Math.cos(i / 10) * 80);
    rows.push({
      pool_id: poolId,
      chain_id: chainId,
      ts: ts.toISOString().replace("Z", ""),
      block_number: 18_000_000 + i,
      reserve_base: 25_000_000 + i * 10_000,
      reserve_quote: 24_500_000 - i * 8_000,
      total_lp_supply: 5_000_000,
      price: 1 + Math.sin(i / 20) * 0.01,
      r_bps: rBps,
      loss_quote_bps: lossQuoteBps,
      twap_bps: twapBps,
      sample_source: "seed-demo",
      tags: ["demo"],
      inserted_at: new Date().toISOString().replace("Z", ""),
    });
  }

  await client.insert({
    table: "liquidityguard.pool_samples",
    values: rows,
    format: "JSONEachRow",
  });

  const windowStart = addMinutes(now, -90);
  const windowEnd = addMinutes(now, -30);
  const riskId = `${poolId}|${Math.floor(windowStart.getTime() / 1000)}`;

  await client.insert({
    table: "liquidityguard.risk_events",
    values: [
      {
        risk_id: riskId,
        pool_id: poolId,
        chain_id: chainId,
        risk_type: "DEPEG_LP",
        risk_state: "RESOLVED",
        window_start: windowStart.toISOString().replace("Z", ""),
        window_end: windowEnd.toISOString().replace("Z", ""),
        severity_bps: 150,
        twap_bps: 9900,
        r_bps: 4800,
        attested_at: now.toISOString().replace("Z", ""),
        attestor: "0xAttestor",
        snapshot_cid: "bafy-demo",
        meta: JSON.stringify({ source: "seed" }),
        version: 1,
        created_at: now.toISOString().replace("Z", ""),
        updated_at: now.toISOString().replace("Z", ""),
      },
    ],
    format: "JSONEachRow",
  });

  await client.insert({
    table: "liquidityguard.snapshots",
    values: [
      {
        snapshot_id: randomUUID(),
        risk_id: riskId,
        pool_id: poolId,
        cid: "bafy-snapshot-demo",
        label: "pool_snapshot",
        note: "Demo snapshot",
        uploaded_at: windowStart.toISOString().replace("Z", ""),
        meta: JSON.stringify({ block: 18_000_050 }),
      },
    ],
    format: "JSONEachRow",
  });

  await client.insert({
    table: "liquidityguard.attestations",
    values: [
      {
        attestation_id: randomUUID(),
        risk_id: riskId,
        signer: "0xAttestor",
        signature: "0xsignature",
        payload: JSON.stringify({ example: true }),
        submitted_at: windowEnd.toISOString().replace("Z", ""),
        onchain_tx: "0xdeadbeef",
      },
    ],
    format: "JSONEachRow",
  });

  console.log("Seed complete.");
  await client.close();
}

seed().catch((error) => {
  console.error("Seed failed", error);
  process.exit(1);
});

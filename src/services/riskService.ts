import { Buffer } from "buffer";
import { clickhouseQuery } from "../db/clickhouse";
import { toDateTimeString } from "../lib/time";

export interface RiskListItem {
  riskId: string;
  product: string;
  poolId: string;
  state: string;
  updatedAt: number;
  latestWindow: { S: number; E: number | null };
  metrics: {
    twap1h: string;
    twap4h: string;
    liquidityUSD: string;
  };
  samplesCount: number;
}

export interface RiskListResponse {
  items: RiskListItem[];
  cursor?: string;
}

export interface RiskDetailTelemetryPoint {
  ts: string;
  block: number;
  r_bps: number;
  lossQuoteBps: number;
  twap30mBps: number;
}

export interface RiskDetailSnapshot {
  id: string;
  type: string;
  cid: string;
  uploadedAt: string;
  note?: string;
}

export interface RiskDetailAttestation {
  attId: string;
  type: string;
  signer: string;
  signature: string;
  payload: unknown;
  submittedAt: string;
  onchainTx?: string;
}

export interface RiskDetail {
  riskId: string;
  poolId: string;
  product: string;
  state: string;
  window: { start: string; end: string | null };
  metrics: {
    r_bps: number;
    lossQuoteBps: number;
    twap30mBps: number;
    severityBps: number;
    minReserveBps: number;
    samplesCount: number;
  };
  telemetry: RiskDetailTelemetryPoint[];
  snapshots: RiskDetailSnapshot[];
  attestations: RiskDetailAttestation[];
}

interface RiskRow {
  risk_id: string;
  pool_id: string;
  chain_id: number;
  risk_type: string;
  risk_state: string;
  window_start: string;
  window_end: string | null;
  severity_bps: number;
  twap_bps: number;
  r_bps: number;
  attested_at: string;
  updated_at: string;
  version: number;
}

interface MetricsRow {
  twap1h: number | null;
  twap4h: number | null;
  liquidity_usd: number | null;
  samples: number;
}

interface DetailMetricsRow {
  min_r_bps: number | null;
  max_loss_bps: number | null;
  avg_twap_bps: number | null;
  samples: number;
}

function encodeCursor(attestedAt: string, riskId: string) {
  return Buffer.from(JSON.stringify({ attestedAt, riskId })).toString(
    "base64url"
  );
}

function decodeCursor(cursor: string) {
  return JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
    attestedAt: string;
    riskId: string;
  };
}

export async function listRisks({
  limit,
  cursor,
}: {
  limit: number;
  cursor?: string;
}): Promise<RiskListResponse> {
  const decodedCursor = cursor ? decodeCursor(cursor) : null;

  const rows = await clickhouseQuery<RiskRow>({
    query: `
      SELECT
        risk_id,
        pool_id,
        chain_id,
        risk_type,
        risk_state,
        window_start,
        window_end,
        severity_bps,
        twap_bps,
        r_bps,
        attested_at,
        updated_at,
        version
      FROM liquidityguard.risk_events FINAL
      WHERE 1
        ${
          decodedCursor
            ? "AND (attested_at < toDateTime64({cursorAttestedAt:String}, 3) OR (attested_at = toDateTime64({cursorAttestedAt:String}, 3) AND risk_id < {cursorRiskId:String}))"
            : ""
        }
      ORDER BY attested_at DESC, risk_id DESC
      LIMIT {limit:UInt32}
    `,
    params: {
      limit: limit + 1,
      cursorAttestedAt: decodedCursor?.attestedAt,
      cursorRiskId: decodedCursor?.riskId,
    },
  });

  const hasMore = rows.length > limit;
  if (hasMore) {
    rows.pop();
  }

  const items: RiskListItem[] = [];
  for (const row of rows) {
    const metrics = await fetchListMetrics(row);

    items.push({
      riskId: row.risk_id,
      product: row.risk_type || "DEPEG_LP",
      poolId: row.pool_id,
      state: row.risk_state,
      updatedAt: Math.floor(new Date(row.updated_at).getTime() / 1000),
      latestWindow: {
        S: Math.floor(new Date(row.window_start).getTime() / 1000),
        E: row.window_end
          ? Math.floor(new Date(row.window_end).getTime() / 1000)
          : null,
      },
      metrics: {
        twap1h: formatBps(metrics.twap1h),
        twap4h: formatBps(metrics.twap4h),
        liquidityUSD: formatUsd(metrics.liquidity_usd),
      },
      samplesCount: metrics.samples,
    });
  }

  const lastRow = rows[rows.length - 1];
  if (hasMore && lastRow) {
    return {
      items,
      cursor: encodeCursor(lastRow.attested_at, lastRow.risk_id),
    };
  }
  return { items };
}

async function fetchListMetrics(row: RiskRow): Promise<MetricsRow> {
  const start = row.window_start;
  const end = row.window_end ?? toDateTimeString(new Date());

  const result = await clickhouseQuery<MetricsRow>({
    query: `
      SELECT
        avgIf(twap_bps, ts >= toDateTime64({end:String}, 3) - INTERVAL 1 HOUR) AS twap1h,
        avgIf(twap_bps, ts >= toDateTime64({end:String}, 3) - INTERVAL 4 HOUR) AS twap4h,
        avg(reserve_base + reserve_quote) AS liquidity_usd,
        count() AS samples
      FROM liquidityguard.pool_samples
      WHERE pool_id = {poolId:String}
        AND ts BETWEEN toDateTime64({start:String}, 3) AND toDateTime64({end:String}, 3)
    `,
    params: {
      poolId: row.pool_id,
      start,
      end,
    },
  });

  return (
    result[0] ?? {
      twap1h: null,
      twap4h: null,
      liquidity_usd: null,
      samples: 0,
    }
  );
}

export async function getRiskDetail(
  riskId: string
): Promise<RiskDetail | null> {
  const rows = await clickhouseQuery<RiskRow>({
    query: `
      SELECT
        risk_id,
        pool_id,
        chain_id,
        risk_type,
        risk_state,
        window_start,
        window_end,
        severity_bps,
        twap_bps,
        r_bps,
        attested_at,
        updated_at,
        version
      FROM liquidityguard.risk_events FINAL
      WHERE risk_id = {riskId:String}
      ORDER BY version DESC
      LIMIT 1
    `,
    params: { riskId },
  });

  if (rows.length === 0) return null;
  const row = rows[0]!;

  const start = row.window_start;
  const end = row.window_end ?? toDateTimeString(new Date());

  const [metricsRow] = await clickhouseQuery<DetailMetricsRow>({
    query: `
      SELECT
        min(r_bps) AS min_r_bps,
        max(loss_quote_bps) AS max_loss_bps,
        avg(twap_bps) AS avg_twap_bps,
        count() AS samples
      FROM liquidityguard.pool_samples
      WHERE pool_id = {poolId:String}
        AND ts BETWEEN toDateTime64({start:String}, 3) AND toDateTime64({end:String}, 3)
    `,
    params: { poolId: row.pool_id, start, end },
  });

  const telemetryRows = await clickhouseQuery<{
    ts: string;
    block_number: number;
    r_bps: number;
    loss_quote_bps: number;
    twap_bps: number;
  }>({
    query: `
      SELECT
        ts,
        block_number,
        r_bps,
        loss_quote_bps,
        twap_bps
      FROM liquidityguard.pool_samples
      WHERE pool_id = {poolId:String}
        AND ts BETWEEN toDateTime64({start:String}, 3) AND toDateTime64({end:String}, 3)
      ORDER BY ts ASC
      LIMIT 5000
    `,
    params: { poolId: row.pool_id, start, end },
  });

  const snapshots = await clickhouseQuery<{
    snapshot_id: string;
    cid: string;
    label: string;
    note: string | null;
    uploaded_at: string;
  }>({
    query: `
      SELECT snapshot_id, cid, label, note, uploaded_at
      FROM liquidityguard.snapshots
      WHERE risk_id = {riskId:String}
      ORDER BY uploaded_at ASC
    `,
    params: { riskId: row.risk_id },
  });

  const attestations = await clickhouseQuery<{
    attestation_id: string;
    signer: string;
    signature: string;
    payload: string;
    submitted_at: string;
    onchain_tx: string | null;
  }>({
    query: `
      SELECT attestation_id, signer, signature, payload, submitted_at, onchain_tx
      FROM liquidityguard.attestations
      WHERE risk_id = {riskId:String}
      ORDER BY submitted_at ASC
    `,
    params: { riskId: row.risk_id },
  });

  return {
    riskId: row.risk_id,
    poolId: row.pool_id,
    product: row.risk_type || "DEPEG_LP",
    state: row.risk_state,
    window: {
      start: new Date(row.window_start).toISOString(),
      end: row.window_end ? new Date(row.window_end).toISOString() : null,
    },
    metrics: {
      r_bps: row.r_bps,
      lossQuoteBps: metricsRow?.max_loss_bps ?? 0,
      twap30mBps: metricsRow?.avg_twap_bps ?? 0,
      severityBps: row.severity_bps,
      minReserveBps: metricsRow?.min_r_bps ?? 0,
      samplesCount: metricsRow?.samples ?? 0,
    },
    telemetry: telemetryRows.map((t) => ({
      ts: new Date(t.ts).toISOString(),
      block: t.block_number,
      r_bps: t.r_bps,
      lossQuoteBps: t.loss_quote_bps,
      twap30mBps: t.twap_bps,
    })),
    snapshots: snapshots.map((s) => ({
      id: s.snapshot_id,
      type: s.label,
      cid: s.cid,
      uploadedAt: new Date(s.uploaded_at).toISOString(),
      ...(s.note != null ? { note: s.note } : {}),
    })),
    attestations: attestations.map((a) => ({
      attId: a.attestation_id,
      type: "DEPEG_ATTEST",
      signer: a.signer,
      signature: a.signature,
      payload: parseJSON(a.payload),
      submittedAt: new Date(a.submitted_at).toISOString(),
      ...(a.onchain_tx != null ? { onchainTx: a.onchain_tx } : {}),
    })),
  };
}

function formatBps(value: number | null) {
  if (value == null) return "0.0000";
  return (value / 10_000).toFixed(4);
}

function formatUsd(value: number | null) {
  if (value == null) return "0.00";
  return value.toFixed(2);
}

function parseJSON(payload: string) {
  try {
    return JSON.parse(payload);
  } catch (error) {
    return payload;
  }
}

import { randomUUID } from 'crypto';
import { z } from 'zod';
import { clickhouseInsert, clickhouseQuery } from '../db/clickhouse';
import { computePayout } from '../lib/payout';
import { buildClaimTypedData, signClaimTypedData } from '../lib/signing';
import { env } from '../config/env';
import { toDateTimeString } from '../lib/time';
import { keccak256, toUtf8Bytes } from 'ethers';

const policySchema = z.object({
  policyId: z.string(),
  product: z.enum(['DEPEG_LP']),
  riskId: z.string(),
  owner: z.string(),
  insuredAmount: z.string(),
  coverageCap: z.string(),
  deductibleBps: z.number().int().nonnegative(),
  kBps: z.number().int().nonnegative().default(5_000),
  startAt: z.number().int(),
  activeAt: z.number().int(),
  endAt: z.number().int(),
  claimedUpTo: z.number().int().default(0),
  metadata: z.object({ poolId: z.string().optional() }).optional(),
});

const previewSchema = z.object({
  policy: policySchema,
  claimMode: z.enum(['FINAL', 'PREVIEW']).default('PREVIEW'),
  timestamp: z.number().int().optional(),
});

const signSchema = previewSchema.extend({
  deadline: z.number().int().optional(),
});

interface RiskMetricsRow {
  min_r_bps: number | null;
  max_loss_bps: number | null;
  avg_twap_bps: number | null;
  min_reserve: number | null;
  samples: number;
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

export async function previewClaim(payload: unknown) {
  const input = previewSchema.parse(payload);
  const { policy } = input;

  const risk = await fetchRisk(policy.riskId);
  if (!risk) {
    throw new Error('risk_not_found');
  }

  const metrics = await fetchRiskMetrics(risk.pool_id, risk.window_start, risk.window_end);

  const insuredAmount = BigInt(policy.insuredAmount);
  const coverageCap = BigInt(policy.coverageCap);
  const severityBps = metrics.max_loss_bps ?? risk.severity_bps ?? 0;
  const payout = computePayout({
    policyCoverage: coverageCap,
    kBps: policy.kBps,
    dedBps: policy.deductibleBps,
    lossQuoteBps: severityBps,
  });
  const cappedPayout = payout > coverageCap ? coverageCap : payout;

  const deductibleApplied = Math.max(severityBps - policy.deductibleBps, 0);
  const coverageCapApplied = payout > coverageCap;

  const S = Math.floor(new Date(risk.window_start).getTime() / 1000);
  const E = risk.window_end ? Math.floor(new Date(risk.window_end).getTime() / 1000) : 0;

  const response = {
    riskId: policy.riskId,
    policyId: policy.policyId,
    S,
    E,
    Lstar: severityBps,
    refValue: policy.insuredAmount,
    curValue: (insuredAmount - cappedPayout > 0n ? insuredAmount - cappedPayout : 0n).toString(),
    payout: cappedPayout.toString(),
    twapStart: formatTwap(metrics.avg_twap_bps),
    twapEnd: formatTwap(metrics.avg_twap_bps),
    snapshots: await fetchSnapshots(policy.riskId),
    inputs: {
      minHeldBalance: clampBigInt(insuredAmount - BigInt(policy.claimedUpTo)).toString(),
      deductibleApplied,
      coverageCapApplied,
    },
  };

  return response;
}

export async function signClaim(payload: unknown) {
  const input = signSchema.parse(payload);
  if (!env.SIGNER_PRIVATE_KEY) {
    throw new Error('SIGNER_PRIVATE_KEY not configured');
  }
  if (!env.PAYOUT_VERIFIER_ADDRESS) {
    throw new Error('PAYOUT_VERIFIER_ADDRESS not configured');
  }

  const preview = await previewClaim(payload);
  const risk = await fetchRisk(preview.riskId);
  if (!risk) {
    throw new Error('risk_not_found');
  }

  const nonce = await nextNonce(input.policy.policyId, input.policy.riskId);
  const deadline = BigInt(input.deadline ?? Math.floor(Date.now() / 1000) + 3600);

  const domain = {
    name: "LiquidityGuardPayout",
    version: "1",
    chainId: BigInt(risk.chain_id),
    verifyingContract: env.PAYOUT_VERIFIER_ADDRESS,
  } as const;

  const message = {
    policyId: BigInt(input.policy.policyId),
    riskId: toBytes32(preview.riskId),
    S: BigInt(preview.S),
    E: BigInt(preview.E),
    Lstar: BigInt(preview.Lstar),
    refValue: BigInt(preview.refValue),
    curValue: BigInt(preview.curValue),
    payout: BigInt(preview.payout),
    nonce,
    deadline,
  };

  const typedData = buildClaimTypedData(domain, message);
  const signature = await signClaimTypedData(env.SIGNER_PRIVATE_KEY, typedData);

  await persistClaim({
    claimId: randomUUID(),
    policyId: input.policy.policyId,
    riskId: input.policy.riskId,
    mode: input.claimMode,
    preview,
    signedPayload: message,
    signature,
    payoutAmount: BigInt(preview.payout),
    deductibleBps: input.policy.deductibleBps,
    coverageCap: BigInt(input.policy.coverageCap),
    nonce,
  });

  return {
    policyId: input.policy.policyId,
    riskId: input.policy.riskId,
    typedData,
    signature,
    expiresAt: Number(deadline),
    calc: {
      snapshots: preview.snapshots,
      twap: { start: preview.twapStart, end: preview.twapEnd },
      inputs: preview.inputs,
    },
  };
}

async function fetchRisk(riskId: string) {
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
  return rows[0];
}

async function fetchRiskMetrics(poolId: string, start: string, rawEnd: string | null): Promise<RiskMetricsRow> {
  const end = rawEnd ?? toDateTimeString(new Date());
  const rows = await clickhouseQuery<RiskMetricsRow>({
    query: `
      SELECT
        min(r_bps) AS min_r_bps,
        max(loss_quote_bps) AS max_loss_bps,
        avg(twap_bps) AS avg_twap_bps,
        min(reserve_base + reserve_quote) AS min_reserve,
        count() AS samples
      FROM liquidityguard.pool_samples
      WHERE pool_id = {poolId:String}
        AND ts BETWEEN toDateTime64({start:String}, 3) AND toDateTime64({end:String}, 3)
    `,
    params: { poolId, start, end },
  });

  return (
    rows[0] ?? {
      min_r_bps: null,
      max_loss_bps: null,
      avg_twap_bps: null,
      min_reserve: null,
      samples: 0,
    }
  );
}

async function fetchSnapshots(riskId: string) {
  const rows = await clickhouseQuery<{
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
    params: { riskId },
  });

  return rows.map((row) => ({
    id: row.snapshot_id,
    type: row.label,
    cid: row.cid,
    uploadedAt: new Date(row.uploaded_at).toISOString(),
    note: row.note ?? undefined,
  }));
}

async function nextNonce(policyId: string, riskId: string): Promise<bigint> {
  const rows = await clickhouseQuery<{ nonce: number }>({
    query: `
      SELECT nonce
      FROM liquidityguard.claim_nonces FINAL
      WHERE policy_id = {policyId:String} AND risk_id = {riskId:String}
      LIMIT 1
    `,
    params: { policyId, riskId },
  });

  const current = rows[0]?.nonce ?? 0;
  const next = BigInt(current + 1);

  await clickhouseInsert({
    table: 'liquidityguard.claim_nonces',
    values: [
      {
        policy_id: policyId,
        risk_id: riskId,
        nonce: next.toString(),
        updated_at: toDateTimeString(new Date()),
      },
    ],
  });

  return next;
}

async function persistClaim(params: {
  claimId: string;
  policyId: string;
  riskId: string;
  mode: string;
  preview: unknown;
  signedPayload: unknown;
  signature: string;
  payoutAmount: bigint;
  deductibleBps: number;
  coverageCap: bigint;
  nonce: bigint;
}) {
  const now = toDateTimeString(new Date());
  await clickhouseInsert({
    table: 'liquidityguard.claims',
    values: [
      {
        claim_id: params.claimId,
        policy_id: params.policyId,
        risk_id: params.riskId,
        mode: params.mode,
        preview: JSON.stringify(params.preview),
        signed_payload: JSON.stringify(params.signedPayload),
        signature: params.signature,
        payout_amount: params.payoutAmount.toString(),
        deductible_bps: params.deductibleBps,
        coverage_cap: params.coverageCap.toString(),
        nonce: params.nonce.toString(),
        state: 'SIGNED',
        created_at: now,
        updated_at: now,
      },
    ],
  });
}

function toBytes32(value: string): string {
  return keccak256(toUtf8Bytes(value));
}

function formatTwap(value: number | null) {
  if (value == null) return '0.0000';
  return (value / 10_000).toFixed(4);
}

function clampBigInt(value: bigint) {
  return value >= 0n ? value : 0n;
}

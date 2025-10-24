export interface PayoutInput {
  policyCoverage: bigint;
  kBps: number;
  dedBps: number;
  lossQuoteBps: number;
}

const BPS_BASE = 10_000n;

export function computePayout({
  policyCoverage,
  kBps,
  dedBps,
  lossQuoteBps,
}: PayoutInput): bigint {
  const severity = BigInt(Math.max(lossQuoteBps - dedBps, 0));
  if (severity === 0n) {
    return 0n;
  }

  const k = BigInt(kBps);
  const payout = (policyCoverage * k * severity) / (BPS_BASE * BPS_BASE);
  return payout;
}

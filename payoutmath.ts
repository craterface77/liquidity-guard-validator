// utils/payout.ts
export function computePayout({
  policyCoverage,   // in USDC cents / 6-decimals integer
  kBps,             // e.g. 5000 => 50%
  dedBps,           // deductible in bps (e.g. 25 => 0.25%)
  lossQuoteBps      // measured severity in bps (e.g. 75 => .75%)
}: {
  policyCoverage: bigint, kBps: number, dedBps: number, lossQuoteBps: number
}): bigint {
  // payout = k * coverage * max(0, S - ded)
  // Use integer math: we store everything in bps where 1e4 = 100%
  const S = BigInt(lossQuoteBps); // bps*1
  const ded = BigInt(dedBps);
  const k = BigInt(kBps);         // in bps/10000
  const bpsBase = 10000n;

  const severity = S > ded ? (S - ded) : 0n; // in bps
  if (severity === 0n) return 0n;

  // payout = coverage * k/10000 * severity/10000
  // => coverage * k * severity / 10000 / 10000
  const payout = (BigInt(policyCoverage) * k * severity) / (bpsBase * bpsBase);
  return payout; // same units as policyCoverage (cents)
}

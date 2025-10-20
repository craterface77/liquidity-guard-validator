import {
  CURVE_POOL,
  DEFAULT_HTTP_PORT,
  DEFAULT_POLL_INTERVAL_MS,
  DETECTOR_THRESHOLDS,
  PAYOUT_PARAMS,
  Q_BASE_UNITS,
  USDC_DECIMALS,
  USDF_DECIMALS,
} from "./constants.js";
import {
  PLACEHOLDER_PREFIX,
  PLACEHOLDER_SUFFIX,
  envConfig,
  unresolvedConfigKeys,
} from "./env.js";

const computeRawBaseAmount = (human: number, decimals: number) => {
  const scale = BigInt(10) ** BigInt(decimals);
  const [wholePartRaw = "0", fractionalPartRaw = ""] = human
    .toString()
    .split(".");
  const normalizedFraction =
    fractionalPartRaw.length >= decimals
      ? fractionalPartRaw.slice(0, decimals)
      : fractionalPartRaw.padEnd(decimals, "0");
  const whole = BigInt(wholePartRaw);
  const fraction = normalizedFraction ? BigInt(normalizedFraction) : 0n;
  return (whole * scale + fraction).toString();
};

export const curveConfig = {
  pool: CURVE_POOL,
  pollIntervalMs: envConfig.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
  qBaseHuman: Q_BASE_UNITS,
  qBaseRaw: computeRawBaseAmount(Q_BASE_UNITS, USDC_DECIMALS),
  usdcDecimals: USDC_DECIMALS,
  usdfDecimals: USDF_DECIMALS,
  coinAddresses: [...CURVE_POOL.coinAddresses],
};

export const detectorConfig = {
  gracePeriodSeconds: DETECTOR_THRESHOLDS.gracePeriodSeconds,
  minimumReserveRatio: DETECTOR_THRESHOLDS.minimumReserveRatio,
};

export const payoutConfig = PAYOUT_PARAMS;

export const runtimeConfig = {
  rpcUrl: envConfig.rpcUrl,
  httpPort: envConfig.httpPort ?? DEFAULT_HTTP_PORT,
  pollIntervalMs: envConfig.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
  clickhouseUrl: envConfig.clickhouseUrl,
  signerPrivateKey: envConfig.signerPrivateKey,
  forkBlock: envConfig.forkBlock,
};

export { unresolvedConfigKeys };

export const isPlaceholderValue = (value: unknown): value is string =>
  typeof value === "string" &&
  value.startsWith(PLACEHOLDER_PREFIX) &&
  value.endsWith(PLACEHOLDER_SUFFIX);

export const CURVE_POOL = {
  address: "0x72310daaed61321b02b08a547150c07522c6a976", // Curve USDC/USDf pool
  chainId: 1,
  coinAddresses: [] as string[],
};

export const USDC_DECIMALS = 6;
export const USDF_DECIMALS = 6;

export const DETECTOR_THRESHOLDS = {
  minimumReserveRatio: 0.25, // USDC / (USDC + USDf)
  gracePeriodSeconds: 15 * 60,
};

export const Q_BASE_UNITS = 100_000; // base quote size in stable units

export const PAYOUT_PARAMS = {
  lMaxBps: 50, // 0.50%
  kBps: 5_000, // 50%
  deductibleBps: 25, // 0.25%
};

export const DEFAULT_HTTP_PORT = 3000;
export const DEFAULT_POLL_INTERVAL_MS = 10_000;

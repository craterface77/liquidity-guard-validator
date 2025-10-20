import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { formatUnits } from "ethers";
import {
  curveConfig,
  runtimeConfig,
  isPlaceholderValue,
} from "../config/index.js";
import { CurveIndexer } from "../lib/curve/indexer.js";
import { logger } from "../utils/logger.js";

const SAMPLE_BUFFER: Array<{ ts: number; price: number }> = [];
const MAX_SAMPLES = 180 * 3;

if (isPlaceholderValue(runtimeConfig.rpcUrl)) {
  throw new Error(
    "RPC_URL is not configured. Set RPC_URL in your environment."
  );
}

const fallbackCoins = Array.isArray(curveConfig.coinAddresses)
  ? curveConfig.coinAddresses.filter(
      (addr): addr is string => typeof addr === "string" && addr.startsWith("0x")
    )
  : undefined;

const indexer = new CurveIndexer(
  runtimeConfig.rpcUrl,
  curveConfig.pool.address,
  fallbackCoins
);

const ensureDataDir = () => {
  const dir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
};

const persistSample = (row: Record<string, unknown>) => {
  const dir = ensureDataDir();
  const outPath = path.join(dir, `${curveConfig.pool.address}.ndjson`);
  fs.appendFileSync(outPath, JSON.stringify(row) + "\n");
};

const computeTwap30 = () => {
  const now = Date.now() / 1000;
  const horizon = now - 30 * 60;
  const last30 = SAMPLE_BUFFER.filter((sample) => sample.ts >= horizon);
  if (!last30.length) return null;
  const sum = last30.reduce((acc, sample) => acc + sample.price, 0);
  return sum / last30.length;
};

export const pollOnce = async () => {
  const blockNumber = await indexer.provider.getBlockNumber();
  const block = await indexer.provider.getBlock(blockNumber);
  if (!block) {
    throw new Error(`Unable to fetch block ${blockNumber}`);
  }
  const timestamp = Number(block.timestamp);

  const [coin0, coin1] = await indexer.getCoinAddresses();
  const [dec0, dec1] = await Promise.all([
    indexer.getTokenDecimals(coin0),
    indexer.getTokenDecimals(coin1),
  ]);

  const balances = await indexer.balancesAt(blockNumber);
  const reserve0 = Number(formatUnits(balances.b0, dec0));
  const reserve1 = Number(formatUnits(balances.b1, dec1));

  const price = reserve0 / reserve1;
  const reserveRatio = reserve0 / (reserve0 + reserve1);

  SAMPLE_BUFFER.push({ ts: timestamp, price });
  while (SAMPLE_BUFFER.length > MAX_SAMPLES) {
    SAMPLE_BUFFER.shift();
  }
  const twap30 = computeTwap30() ?? price;

  let amountOutHuman: number | null = null;
  try {
    const amountOutRaw = await indexer.tryGetDy(
      1,
      0,
      curveConfig.qBaseRaw,
      blockNumber
    );
    if (amountOutRaw) {
      amountOutHuman = Number(formatUnits(amountOutRaw, dec0));
    }
  } catch (error) {
    logger.warn({ err: error }, "Failed to compute get_dy for sample");
  }

  const qBaseHuman = curveConfig.qBaseHuman;
  const lossPct =
    amountOutHuman === null ? null : (qBaseHuman - amountOutHuman) / qBaseHuman;

  const row = {
    pool: curveConfig.pool.address,
    ts: new Date(timestamp * 1000).toISOString(),
    block: blockNumber,
    coin0,
    coin1,
    reserve0,
    reserve1,
    reserveRatio,
    price,
    twap30,
    qBaseHuman,
    amountOutHuman,
    lossPct,
  };

  persistSample(row);
  logger.info(
    {
      block: blockNumber,
      reserveRatio: reserveRatio.toFixed(4),
      twap30: twap30.toFixed(6),
      lossPct: lossPct === null ? null : lossPct * 100,
    },
    "Indexed pool state"
  );
};

export const startPolling = async () => {
  logger.info(
    {
      pool: curveConfig.pool.address,
      pollIntervalMs: runtimeConfig.pollIntervalMs,
    },
    "Starting Curve poller"
  );

  await pollOnce();

  setInterval(async () => {
    try {
      await pollOnce();
    } catch (error) {
      logger.error({ err: error }, "pollOnce failed");
    }
  }, runtimeConfig.pollIntervalMs);
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startPolling().catch((error) => {
    logger.error({ err: error }, "Fatal error in indexer");
    process.exit(1);
  });
}

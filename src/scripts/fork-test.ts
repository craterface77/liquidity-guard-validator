import { pathToFileURL } from "url";
import { CurveIndexer } from "../lib/curve/indexer.js";
import { Detector } from "../core/detector.js";
import {
  curveConfig,
  detectorConfig,
  runtimeConfig,
  isPlaceholderValue,
} from "../config/index.js";
import { logger } from "../utils/logger.js";

const SAMPLES = Number(process.env.FORK_SAMPLES ?? 60);

const ensureRpcConfigured = () => {
  if (isPlaceholderValue(runtimeConfig.rpcUrl)) {
    throw new Error("RPC_URL is required for fork-test script.");
  }
};

const run = async () => {
  ensureRpcConfigured();

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
  const detector = new Detector(indexer, {
    minimumReserveRatio: detectorConfig.minimumReserveRatio,
    gracePeriodSeconds: detectorConfig.gracePeriodSeconds,
    usdcDecimals: curveConfig.usdcDecimals,
    usdfDecimals: curveConfig.usdfDecimals,
  });

  const nowBlock =
    runtimeConfig.forkBlock ?? (await indexer.provider.getBlockNumber());
  logger.info({ block: nowBlock }, "Using starting block for fork test");

  const [coin0, coin1] = await indexer.getCoinAddresses();
  logger.info({ coin0, coin1 }, "Pool coin mapping");

  for (let i = 0; i < SAMPLES; i += 1) {
    const blockTag = nowBlock + i;
    const block = await indexer.provider.getBlock(blockTag);
    if (!block) {
      logger.warn({ blockTag }, "Block not available on RPC");
      continue;
    }
    const event = await detector.sample(Number(block.timestamp), blockTag);
    if (event) {
      logger.info({ event }, "Detector emitted event");
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    logger.error({ err: error }, "Fork test failed");
    process.exit(1);
  });
}

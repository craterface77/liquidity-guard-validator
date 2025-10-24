import { env } from "../config/env";
import { logger } from "../lib/logger";
import { IndexerService } from "../services/indexer/indexerService";
import { AaveDlpMonitor } from "../services/indexer/aaveDlpMonitor";
import { emitWebhook } from "../services/webhookService";

const service = new IndexerService(emitWebhook);

// Initialize Aave DLP monitor if enabled
let aaveMonitor: AaveDlpMonitor | null = null;
if (env.ENABLE_AAVE_MONITORING) {
  if (
    !env.AAVE_LENDING_POOL_ADDRESS ||
    !env.AAVE_COLLATERAL_ASSET ||
    !env.AAVE_PRICE_FEED
  ) {
    logger.error(
      "aave_monitoring_enabled_but_missing_config",
      "ENABLE_AAVE_MONITORING is true but required Aave config is missing"
    );
    process.exit(1);
  }

  aaveMonitor = new AaveDlpMonitor(
    {
      collateralAsset: env.AAVE_COLLATERAL_ASSET,
      priceFeedAddress: env.AAVE_PRICE_FEED,
      depegThreshold: env.AAVE_DEPEG_THRESHOLD,
      correlationWindowSeconds: 3600, // 1 hour
      poolId: env.AAVE_POOL_ID,
      chainId: env.CHAIN_ID,
    },
    emitWebhook
  );

  logger.info(
    {
      poolId: env.AAVE_POOL_ID,
      collateralAsset: env.AAVE_COLLATERAL_ASSET,
      depegThreshold: env.AAVE_DEPEG_THRESHOLD,
    },
    "aave_dlp_monitor_initialized"
  );
}

async function loop() {
  try {
    await service.poll();
  } catch (error) {
    logger.error({ err: error }, "indexer_poll_failed");
  } finally {
    setTimeout(loop, env.POLL_INTERVAL_MS);
  }
}

async function aaveLoop() {
  if (!aaveMonitor) return;

  try {
    await aaveMonitor.poll();
  } catch (error) {
    logger.error({ err: error }, "aave_monitor_poll_failed");
  } finally {
    setTimeout(aaveLoop, env.POLL_INTERVAL_MS);
  }
}

// Start both monitoring loops
loop();
if (aaveMonitor) {
  aaveLoop();
}

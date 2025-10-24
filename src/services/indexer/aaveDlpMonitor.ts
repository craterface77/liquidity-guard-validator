import { randomUUID } from "crypto";
import { clickhouseInsert } from "../../db/clickhouse";
import { logger } from "../../lib/logger";
import { toDateTimeString } from "../../lib/time";
import { createSnapshot } from "../../lib/ipfs";
import {
  AaveIndexer,
  type LiquidationEvent,
  type CollateralPrice,
} from "./aaveIndexer";
import type { WebhookEmitter } from "./indexerService";

export interface AaveDlpConfig {
  collateralAsset: string; // e.g., PYUSD address
  priceFeedAddress: string; // Chainlink price feed
  depegThreshold: number; // e.g., 0.02 for 2%
  correlationWindowSeconds: number; // e.g., 3600 (1 hour)
  poolId: string; // e.g., "aave-pyusd"
  chainId: number;
}

interface DepegWindow {
  riskId: string;
  start: number;
  priceAtStart: number;
  maxDeviation: number;
  liquidations: LiquidationEvent[];
}

/**
 * Monitors Aave for depeg-triggered liquidations
 *
 * Flow:
 * 1. Monitor collateral asset price (Chainlink)
 * 2. Detect depeg events (deviation > threshold)
 * 3. Monitor liquidations during depeg window
 * 4. Correlate liquidations with depeg
 * 5. Emit DEPEG_LIQ events for matching liquidations
 */
export class AaveDlpMonitor {
  private readonly indexer: AaveIndexer;
  private activeDepegWindow: DepegWindow | null = null;
  private lastPriceCheck: number = 0;
  private lastPrice: number = 1.0;

  constructor(
    private readonly config: AaveDlpConfig,
    private readonly emitWebhook: WebhookEmitter = async () => {}
  ) {
    this.indexer = new AaveIndexer();
  }

  /**
   * Main polling function - checks for depegs and liquidations
   */
  async poll() {
    const now = Math.floor(Date.now() / 1000);

    // Get current price (with Pyth fallback)
    const priceData = await this.indexer.getCollateralPrice(
      this.config.priceFeedAddress,
      process.env.PYTH_PRICE_FEED_ID // Optional Pyth feed ID for fallback
    );

    if (!priceData) {
      logger.warn("failed_to_get_price_data_from_all_sources");
      return;
    }

    this.lastPrice = priceData.price;
    this.lastPriceCheck = now;

    // Store price sample in ClickHouse
    await this.storePriceSample(priceData, now);

    // Check for depeg
    const isDepegged = priceData.deviation >= this.config.depegThreshold;

    // Start depeg window if needed
    if (isDepegged && !this.activeDepegWindow) {
      await this.startDepegWindow(priceData, now);
    }

    // If in active depeg window, check for liquidations
    if (this.activeDepegWindow) {
      await this.checkLiquidations();

      // Update max deviation
      this.activeDepegWindow.maxDeviation = Math.max(
        this.activeDepegWindow.maxDeviation,
        priceData.deviation
      );

      // Close window if price recovered
      if (!isDepegged) {
        await this.closeDepegWindow(now);
      }
    }
  }

  /**
   * Start tracking a depeg event
   */
  private async startDepegWindow(
    priceData: CollateralPrice,
    timestamp: number
  ) {
    const riskId = `${this.config.poolId}|${timestamp}`;

    logger.info(
      {
        riskId,
        price: priceData.price,
        deviation: priceData.deviation,
        collateralAsset: this.config.collateralAsset,
      },
      "aave_depeg_window_opened"
    );

    // Create snapshot for Aave DLP (using PoolSnapshot format)
    const snapshotCid = await createSnapshot({
      timestamp,
      blockNumber: 0, // Would need to fetch current block
      poolId: this.config.poolId,
      chainId: this.config.chainId,
      reserves: {
        base: 0, // Not applicable for Aave DLP
        quote: 0,
        totalSupply: 0,
      },
      price: priceData.price,
      rBps: 10000, // Not applicable - using price feed
      lossQuoteBps: Math.floor(priceData.deviation * 10000),
      twapBps: Math.floor((1 - priceData.price) * 10000),
    });

    // Store in ClickHouse
    await clickhouseInsert({
      table: "liquidityguard.risk_events",
      values: [
        {
          risk_id: riskId,
          pool_id: this.config.poolId,
          chain_id: this.config.chainId,
          risk_type: "AAVE_DLP",
          risk_state: "OPEN",
          window_start: toDateTimeString(timestamp * 1000),
          window_end: null,
          severity_bps: Math.floor(priceData.deviation * 10000),
          twap_bps: Math.floor((1.0 - priceData.price) * 10000),
          r_bps: 0, // Not applicable for Aave
          attested_at: toDateTimeString(new Date()),
          attestor: "0x0000000000000000000000000000000000000000",
          snapshot_cid: snapshotCid,
          meta: JSON.stringify({
            collateralAsset: this.config.collateralAsset,
            priceAtStart: priceData.price,
          }),
          version: 1,
          created_at: toDateTimeString(new Date()),
          updated_at: toDateTimeString(new Date()),
        },
      ],
    });

    // Emit webhook
    await this.emitWebhook({
      kind: "DEPEG_START",
      payload: {
        type: "DEPEG_START",
        riskId,
        poolId: this.config.poolId,
        chainId: this.config.chainId,
        timestamp,
        collateralAsset: this.config.collateralAsset,
        price: priceData.price,
        deviation: priceData.deviation,
        snapshotCid,
      },
    });

    this.activeDepegWindow = {
      riskId,
      start: timestamp,
      priceAtStart: priceData.price,
      maxDeviation: priceData.deviation,
      liquidations: [],
    };
  }

  /**
   * Check for new liquidations during depeg window
   */
  private async checkLiquidations() {
    if (!this.activeDepegWindow) return;

    // Poll for new liquidations
    const liquidations = await this.indexer.pollLiquidations(
      this.config.collateralAsset
    );

    if (liquidations.length === 0) return;

    logger.info(
      {
        riskId: this.activeDepegWindow.riskId,
        liquidationCount: liquidations.length,
      },
      "detected_depeg_liquidations"
    );

    // Process each liquidation
    for (const liquidation of liquidations) {
      await this.processLiquidation(liquidation);
    }

    this.activeDepegWindow.liquidations.push(...liquidations);
  }

  /**
   * Process a single liquidation event
   */
  private async processLiquidation(liquidation: LiquidationEvent) {
    if (!this.activeDepegWindow) return;

    const liquidationId = `${liquidation.transactionHash}-${liquidation.user}`;

    // Store liquidation in ClickHouse
    await clickhouseInsert({
      table: "liquidityguard.liquidations",
      values: [
        {
          liquidation_id: liquidationId,
          risk_id: this.activeDepegWindow.riskId,
          pool_id: this.config.poolId,
          user_address: liquidation.user,
          collateral_asset: liquidation.collateralAsset,
          debt_asset: liquidation.debtAsset,
          liquidated_collateral_amount:
            liquidation.liquidatedCollateralAmount.toString(),
          debt_covered: liquidation.debtToCover.toString(),
          liquidator: liquidation.liquidator,
          timestamp: liquidation.timestamp,
          block_number: liquidation.blockNumber,
          tx_hash: liquidation.transactionHash,
          health_factor_before: liquidation.healthFactorBefore
            ? liquidation.healthFactorBefore.toString()
            : null,
          health_factor_after: liquidation.healthFactorAfter
            ? liquidation.healthFactorAfter.toString()
            : null,
          created_at: toDateTimeString(new Date()),
        },
      ],
    });

    // Create snapshot for this liquidation (using PoolSnapshot format)
    const snapshotCid = await createSnapshot({
      timestamp: liquidation.timestamp,
      blockNumber: liquidation.blockNumber,
      poolId: this.config.poolId,
      chainId: this.config.chainId,
      reserves: {
        base: 0, // Not applicable for Aave DLP
        quote: 0,
        totalSupply: 0,
      },
      price: this.lastPrice,
      rBps: 10000,
      lossQuoteBps: Math.floor(Math.abs(1 - this.lastPrice) * 10000),
      twapBps: Math.floor((1 - this.lastPrice) * 10000),
    });

    // Store snapshot
    await clickhouseInsert({
      table: "liquidityguard.snapshots",
      values: [
        {
          snapshot_id: randomUUID(),
          risk_id: this.activeDepegWindow.riskId,
          pool_id: this.config.poolId,
          cid: snapshotCid,
          label: "DEPEG_LIQ",
          note: `Liquidation for user ${liquidation.user} at block ${liquidation.blockNumber}`,
          uploaded_at: toDateTimeString(new Date()),
          meta: JSON.stringify({
            liquidationId,
            txHash: liquidation.transactionHash,
          }),
        },
      ],
    });

    // Emit DEPEG_LIQ webhook
    await this.emitWebhook({
      kind: "DEPEG_LIQ",
      payload: {
        type: "DEPEG_LIQ",
        riskId: this.activeDepegWindow.riskId,
        poolId: this.config.poolId,
        chainId: this.config.chainId,
        timestamp: liquidation.timestamp,
        liquidationId,
        user: liquidation.user,
        collateralAsset: liquidation.collateralAsset,
        liquidatedAmount: liquidation.liquidatedCollateralAmount.toString(),
        debtCovered: liquidation.debtToCover.toString(),
        price: this.lastPrice,
        deviation: this.activeDepegWindow.maxDeviation,
        txHash: liquidation.transactionHash,
        snapshotCid,
      },
    });

    logger.info(
      {
        riskId: this.activeDepegWindow.riskId,
        liquidationId,
        user: liquidation.user,
        amount: liquidation.liquidatedCollateralAmount.toString(),
      },
      "depeg_liquidation_processed"
    );
  }

  /**
   * Close the depeg window when price recovers
   */
  private async closeDepegWindow(timestamp: number) {
    if (!this.activeDepegWindow) return;

    logger.info(
      {
        riskId: this.activeDepegWindow.riskId,
        duration: timestamp - this.activeDepegWindow.start,
        liquidationCount: this.activeDepegWindow.liquidations.length,
        maxDeviation: this.activeDepegWindow.maxDeviation,
      },
      "aave_depeg_window_closed"
    );

    // Update risk event to RESOLVED
    await clickhouseInsert({
      table: "liquidityguard.risk_events",
      values: [
        {
          risk_id: this.activeDepegWindow.riskId,
          pool_id: this.config.poolId,
          chain_id: this.config.chainId,
          risk_type: "AAVE_DLP",
          risk_state: "RESOLVED",
          window_start: toDateTimeString(this.activeDepegWindow.start * 1000),
          window_end: toDateTimeString(timestamp * 1000),
          severity_bps: Math.floor(this.activeDepegWindow.maxDeviation * 10000),
          twap_bps: Math.floor((1.0 - this.lastPrice) * 10000),
          r_bps: 0,
          attested_at: toDateTimeString(new Date()),
          attestor: "0x0000000000000000000000000000000000000000",
          snapshot_cid: "",
          meta: JSON.stringify({
            collateralAsset: this.config.collateralAsset,
            liquidationCount: this.activeDepegWindow.liquidations.length,
          }),
          version: 2,
          created_at: toDateTimeString(new Date()),
          updated_at: toDateTimeString(new Date()),
        },
      ],
    });

    // Emit DEPEG_END webhook
    await this.emitWebhook({
      kind: "DEPEG_END",
      payload: {
        type: "DEPEG_END",
        riskId: this.activeDepegWindow.riskId,
        poolId: this.config.poolId,
        chainId: this.config.chainId,
        timestamp,
        liquidationCount: this.activeDepegWindow.liquidations.length,
      },
    });

    this.activeDepegWindow = null;
  }

  /**
   * Store price sample in ClickHouse
   */
  private async storePriceSample(
    priceData: CollateralPrice,
    timestamp: number
  ) {
    await clickhouseInsert({
      table: "liquidityguard.pool_samples",
      values: [
        {
          pool_id: this.config.poolId,
          chain_id: this.config.chainId,
          ts: toDateTimeString(timestamp * 1000),
          block_number: 0, // Would need to fetch
          reserve_base: 0, // Not applicable for Aave
          reserve_quote: 0,
          total_lp_supply: 0,
          price: priceData.price,
          r_bps: 0,
          loss_quote_bps: Math.floor((1.0 - priceData.price) * 10000),
          twap_bps: Math.floor((1.0 - priceData.price) * 10000),
          sample_source: "chainlink",
          tags: ["aave", "dlp"],
        },
      ],
    });
  }
}

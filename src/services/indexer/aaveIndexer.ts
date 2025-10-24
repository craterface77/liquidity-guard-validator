import { Contract, JsonRpcProvider, EventLog } from "ethers";
import { env } from "../../config/env";
import { logger } from "../../lib/logger";
import {
  PythPriceOracle,
  PYTH_CONTRACT_ADDRESSES,
} from "../oracles/pythPriceOracle";

// Aave V3 LendingPool ABI (minimal)
const AAVE_LENDING_POOL_ABI = [
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "collateralAsset", type: "address" },
      { indexed: true, name: "debtAsset", type: "address" },
      { indexed: true, name: "user", type: "address" },
      { indexed: false, name: "debtToCover", type: "uint256" },
      { indexed: false, name: "liquidatedCollateralAmount", type: "uint256" },
      { indexed: false, name: "liquidator", type: "address" },
      { indexed: false, name: "receiveAToken", type: "bool" },
    ],
    name: "LiquidationCall",
    type: "event",
  },
  {
    inputs: [{ name: "user", type: "address" }],
    name: "getUserAccountData",
    outputs: [
      { name: "totalCollateralBase", type: "uint256" },
      { name: "totalDebtBase", type: "uint256" },
      { name: "availableBorrowsBase", type: "uint256" },
      { name: "currentLiquidationThreshold", type: "uint256" },
      { name: "ltv", type: "uint256" },
      { name: "healthFactor", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
];

// Chainlink Price Feed ABI (minimal)
const CHAINLINK_AGGREGATOR_ABI = [
  {
    inputs: [],
    name: "latestRoundData",
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
    stateMutability: "view",
    type: "function",
  },
];

export interface LiquidationEvent {
  blockNumber: number;
  transactionHash: string;
  timestamp: number;
  user: string;
  collateralAsset: string;
  debtAsset: string;
  liquidatedCollateralAmount: bigint;
  debtToCover: bigint;
  liquidator: string;
  healthFactorBefore: bigint | null;
  healthFactorAfter: bigint | null;
}

export interface CollateralPrice {
  price: number; // in USD with 8 decimals
  timestamp: number;
  deviation: number; // percentage from $1.00 (for stablecoins)
}

export class AaveIndexer {
  private provider: JsonRpcProvider;
  private lendingPool: Contract;
  private pythOracle: PythPriceOracle | null = null;
  private lastProcessedBlock: number = 0;

  constructor() {
    if (!env.RPC_URL) {
      throw new Error("RPC_URL not configured");
    }
    this.provider = new JsonRpcProvider(env.RPC_URL);

    // Get Aave Lending Pool address from env
    const aaveLendingPool = process.env.AAVE_LENDING_POOL_ADDRESS;
    if (!aaveLendingPool) {
      throw new Error("AAVE_LENDING_POOL_ADDRESS not configured");
    }

    this.lendingPool = new Contract(
      aaveLendingPool,
      AAVE_LENDING_POOL_ABI,
      this.provider
    );

    // Initialize Pyth oracle as fallback
    const pythAddress = PYTH_CONTRACT_ADDRESSES[env.CHAIN_ID];
    if (pythAddress) {
      this.pythOracle = new PythPriceOracle(pythAddress, this.provider);
      logger.info(
        { pythAddress, chainId: env.CHAIN_ID },
        "pyth_oracle_initialized_as_fallback"
      );
    }
  }

  /**
   * Fetch liquidation events for a specific collateral asset (stablecoin)
   */
  async fetchLiquidationEvents(
    collateralAsset: string,
    fromBlock: number,
    toBlock: number | "latest"
  ): Promise<LiquidationEvent[]> {
    try {
      const filter = this.lendingPool?.filters?.LiquidationCall?.(
        collateralAsset,
        null,
        null
      );
      if (!filter) {
        throw new Error("LiquidationCall filter not available");
      }
      const events = await this.lendingPool.queryFilter(
        filter,
        fromBlock,
        toBlock
      );

      const liquidations: LiquidationEvent[] = [];

      for (const event of events) {
        if (!(event instanceof EventLog)) continue;

        const block = await this.provider.getBlock(event.blockNumber);
        if (!block) continue;

        const args = event.args;
        liquidations.push({
          blockNumber: event.blockNumber,
          transactionHash: event.transactionHash,
          timestamp: block.timestamp,
          user: args.user,
          collateralAsset: args.collateralAsset,
          debtAsset: args.debtAsset,
          liquidatedCollateralAmount: args.liquidatedCollateralAmount,
          debtToCover: args.debtToCover,
          liquidator: args.liquidator,
          healthFactorBefore: null, // Would need historical data
          healthFactorAfter: null,
        });
      }

      logger.info(
        { collateralAsset, fromBlock, toBlock, count: liquidations.length },
        "fetched_aave_liquidations"
      );

      return liquidations;
    } catch (error) {
      logger.error(
        { err: error, collateralAsset },
        "failed_to_fetch_liquidations"
      );
      return [];
    }
  }

  /**
   * Get user's current health factor
   */
  async getUserHealthFactor(user: string): Promise<bigint | null> {
    try {
      const getUserAccountData = this.lendingPool?.getUserAccountData;
      if (!getUserAccountData) {
        throw new Error("getUserAccountData not available");
      }
      const accountData = await getUserAccountData(user);
      return accountData.healthFactor;
    } catch (error) {
      logger.error({ err: error, user }, "failed_to_get_health_factor");
      return null;
    }
  }

  /**
   * Get collateral price from Chainlink (for stablecoins)
   * Falls back to Pyth if Chainlink fails
   */
  async getCollateralPrice(
    priceFeedAddress: string,
    pythPriceFeedId?: string
  ): Promise<CollateralPrice | null> {
    // Try Chainlink first
    try {
      const priceFeed = new Contract(
        priceFeedAddress,
        CHAINLINK_AGGREGATOR_ABI,
        this.provider
      );
      const latestRoundData = priceFeed.latestRoundData;
      if (!latestRoundData) {
        throw new Error("latestRoundData not available");
      }
      const roundData = await latestRoundData();

      // Chainlink returns price with 8 decimals
      const priceInt = Number(roundData.answer);
      const price = priceInt / 1e8;

      // Calculate deviation from $1.00 (for stablecoins)
      const deviation = Math.abs(price - 1.0) / 1.0;

      logger.debug(
        { price, source: "chainlink" },
        "price_fetched_from_chainlink"
      );

      return {
        price,
        timestamp: Number(roundData.updatedAt),
        deviation,
      };
    } catch (chainlinkError) {
      logger.warn(
        { err: chainlinkError, priceFeedAddress },
        "chainlink_price_fetch_failed_trying_pyth"
      );

      // Fallback to Pyth if available
      if (this.pythOracle && pythPriceFeedId) {
        try {
          const pythPrice = await this.pythOracle.getLatestPrice(
            pythPriceFeedId
          );

          if (pythPrice && PythPriceOracle.isPriceFresh(pythPrice, 60)) {
            const deviation = Math.abs(pythPrice.price - 1.0) / 1.0;

            logger.info(
              { price: pythPrice.price, source: "pyth" },
              "price_fetched_from_pyth_fallback"
            );

            return {
              price: pythPrice.price,
              timestamp: pythPrice.publishTime,
              deviation,
            };
          }
        } catch (pythError) {
          logger.error({ err: pythError }, "pyth_fallback_also_failed");
        }
      }

      logger.error({ priceFeedAddress }, "all_price_sources_failed");
      return null;
    }
  }

  /**
   * Detect depeg-triggered liquidations
   * Returns liquidations that occurred during a depeg event
   */
  async detectDepegLiquidations(params: {
    collateralAsset: string;
    priceFeedAddress: string;
    depegThreshold: number; // e.g., 0.02 for 2% deviation
    fromBlock: number;
    toBlock: number | "latest";
  }): Promise<{
    liquidations: LiquidationEvent[];
    priceData: CollateralPrice | null;
    depegDetected: boolean;
  }> {
    // Get current collateral price
    const priceData = await this.getCollateralPrice(params.priceFeedAddress);

    if (!priceData) {
      return {
        liquidations: [],
        priceData: null,
        depegDetected: false,
      };
    }

    // Check if depeg occurred
    const depegDetected = priceData.deviation >= params.depegThreshold;

    // Fetch liquidation events
    const liquidations = await this.fetchLiquidationEvents(
      params.collateralAsset,
      params.fromBlock,
      params.toBlock
    );

    logger.info(
      {
        collateralAsset: params.collateralAsset,
        price: priceData.price,
        deviation: priceData.deviation,
        depegDetected,
        liquidationCount: liquidations.length,
      },
      "depeg_liquidation_detection"
    );

    return {
      liquidations,
      priceData,
      depegDetected,
    };
  }

  /**
   * Poll for new liquidation events since last check
   */
  async pollLiquidations(collateralAsset: string): Promise<LiquidationEvent[]> {
    const currentBlock = await this.provider.getBlockNumber();

    if (this.lastProcessedBlock === 0) {
      // First run - look back 100 blocks
      this.lastProcessedBlock = Math.max(currentBlock - 100, 0);
    }

    const fromBlock = this.lastProcessedBlock + 1;
    const toBlock = currentBlock;

    if (fromBlock > toBlock) {
      return [];
    }

    const liquidations = await this.fetchLiquidationEvents(
      collateralAsset,
      fromBlock,
      toBlock
    );

    this.lastProcessedBlock = currentBlock;

    return liquidations;
  }

  /**
   * Calculate TWAP for collateral asset from historical prices
   * This would need to fetch multiple historical price points
   */
  async calculateTWAP(
    priceFeedAddress: string,
    durationSeconds: number
  ): Promise<number | null> {
    // TODO: Implement TWAP calculation from historical Chainlink data
    // For now, just return current price
    const priceData = await this.getCollateralPrice(priceFeedAddress);
    return priceData ? priceData.price : null;
  }
}

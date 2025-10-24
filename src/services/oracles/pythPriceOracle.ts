import { Contract, Provider } from "ethers";
import { HermesClient } from "@pythnetwork/hermes-client";
import { logger } from "../../lib/logger";

/**
 * Pyth Network Price Oracle
 *
 * Provides real-time price feeds from Pyth Network as an alternative
 * or fallback to Chainlink price feeds. Pyth offers:
 * - 400ms update latency
 * - 100+ chains supported
 * - Pull-based oracle model
 * - High-frequency trading grade data
 */

export interface PythPriceData {
  price: number;
  confidence: number;
  publishTime: number;
  expo: number;
}

// Pyth price feed IDs for common assets
export const PYTH_PRICE_FEEDS = {
  // Stablecoins
  "PYUSD/USD":
    "0xc3a7d7c2c1c87c4f98e5f4f9e5e9d5c8f5a9b0c3d7e8f9a0b1c2d3e4f5a6b7c8", // Example ID
  "USDC/USD":
    "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a",
  "USDT/USD":
    "0x2b89b9dc8fdf9f34709a5b106b472f0f39bb6ca9ce04b0fd7f2e971688e2e53b",
  "DAI/USD":
    "0xb0948a5e5313200c632b51bb5ca32f6de0d36e9950a942d19751e833f70dabfd",

  // Crypto
  "ETH/USD":
    "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
  "BTC/USD":
    "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
};

// Pyth contract ABI (minimal)
const PYTH_ABI = [
  "function updatePriceFeeds(bytes[] calldata updateData) external payable",
  "function getPrice(bytes32 id) external view returns (int64 price, uint64 conf, int32 expo, uint publishTime)",
  "function getPriceUnsafe(bytes32 id) external view returns (int64 price, uint64 conf, int32 expo, uint publishTime)",
  "function getUpdateFee(bytes[] calldata updateData) external view returns (uint feeAmount)",
];

/**
 * Pyth Price Oracle Service
 * Fetches and updates Pyth price feeds on-chain
 */
export class PythPriceOracle {
  private readonly hermes: HermesClient;
  private readonly pythContract: Contract | null = null;
  private readonly provider: Provider | null = null;

  constructor(pythContractAddress?: string, provider?: Provider) {
    // Initialize Hermes client (Pyth's data service)
    this.hermes = new HermesClient("https://hermes.pyth.network", {
      timeout: 10000,
    });

    if (pythContractAddress && provider) {
      this.provider = provider;
      this.pythContract = new Contract(pythContractAddress, PYTH_ABI, provider);
    }

    logger.info({ pythContractAddress }, "pyth_oracle_initialized");
  }

  /**
   * Get latest price from Hermes (off-chain)
   * This is faster but requires on-chain update for contract consumption
   */
  async getLatestPrice(priceFeedId: string): Promise<PythPriceData | null> {
    try {
      const priceFeeds = await this.hermes.getLatestPriceUpdates([priceFeedId]);

      if (!priceFeeds || !priceFeeds.parsed || priceFeeds.parsed.length === 0) {
        logger.warn({ priceFeedId }, "pyth_no_price_data");
        return null;
      }

      const feed = priceFeeds.parsed[0];
      if (!feed || !feed.price) {
        logger.warn({ priceFeedId }, "pyth_invalid_feed_structure");
        return null;
      }

      const price = Number(feed.price.price) * Math.pow(10, feed.price.expo);
      const confidence =
        Number(feed.price.conf) * Math.pow(10, feed.price.expo);

      logger.debug(
        {
          priceFeedId,
          price,
          confidence,
          publishTime: feed.price.publish_time,
        },
        "pyth_price_fetched"
      );

      return {
        price,
        confidence,
        publishTime: feed.price.publish_time,
        expo: feed.price.expo,
      };
    } catch (error) {
      logger.error({ err: error, priceFeedId }, "pyth_price_fetch_failed");
      return null;
    }
  }

  /**
   * Get price for multiple feeds in batch
   */
  async getBatchPrices(
    priceFeedIds: string[]
  ): Promise<Map<string, PythPriceData>> {
    const results = new Map<string, PythPriceData>();

    try {
      const priceFeeds = await this.hermes.getLatestPriceUpdates(priceFeedIds);

      if (!priceFeeds || !priceFeeds.parsed) {
        return results;
      }

      for (const feed of priceFeeds.parsed) {
        const price = Number(feed.price.price) * Math.pow(10, feed.price.expo);
        const confidence =
          Number(feed.price.conf) * Math.pow(10, feed.price.expo);

        results.set(feed.id, {
          price,
          confidence,
          publishTime: feed.price.publish_time,
          expo: feed.price.expo,
        });
      }

      logger.debug({ count: results.size }, "pyth_batch_prices_fetched");
    } catch (error) {
      logger.error({ err: error }, "pyth_batch_fetch_failed");
    }

    return results;
  }

  /**
   * Get price update data for on-chain consumption
   * Returns the encoded update data that can be passed to updatePriceFeeds()
   */
  async getPriceUpdateData(priceFeedIds: string[]): Promise<string[]> {
    try {
      const priceFeeds = await this.hermes.getLatestPriceUpdates(priceFeedIds);

      if (!priceFeeds || !priceFeeds.binary || !priceFeeds.binary.data) {
        logger.warn({ priceFeedIds }, "pyth_no_update_data");
        return [];
      }

      // Return array of update data as hex strings
      return priceFeeds.binary.data.map((data: string) => `0x${data}`);
    } catch (error) {
      logger.error(
        { err: error, priceFeedIds },
        "pyth_update_data_fetch_failed"
      );
      return [];
    }
  }

  /**
   * Get price directly from on-chain Pyth contract (unsafe - may be stale)
   */
  async getOnchainPrice(priceFeedId: string): Promise<PythPriceData | null> {
    if (!this.pythContract) {
      logger.warn("pyth_contract_not_initialized");
      return null;
    }

    try {
      const getPriceUnsafe = this.pythContract?.getPriceUnsafe;
      if (!getPriceUnsafe) {
        throw new Error("getPriceUnsafe not available");
      }
      const result = await getPriceUnsafe(priceFeedId);
      const price = Number(result.price) * Math.pow(10, result.expo);
      const confidence = Number(result.conf) * Math.pow(10, result.expo);

      return {
        price,
        confidence,
        publishTime: Number(result.publishTime),
        expo: result.expo,
      };
    } catch (error) {
      logger.error({ err: error, priceFeedId }, "pyth_onchain_read_failed");
      return null;
    }
  }

  /**
   * Calculate update fee for given update data
   */
  async getUpdateFee(updateData: string[]): Promise<bigint> {
    if (!this.pythContract) {
      return BigInt(0);
    }

    try {
      const getUpdateFee = this.pythContract?.getUpdateFee;
      if (!getUpdateFee) {
        throw new Error("getUpdateFee not available");
      }
      const fee = await getUpdateFee(updateData);
      return fee;
    } catch (error) {
      logger.error({ err: error }, "pyth_update_fee_failed");
      return BigInt(0);
    }
  }

  /**
   * Get price feed ID by symbol
   */
  static getPriceFeedId(symbol: string): string | null {
    const normalized = symbol.toUpperCase();
    return (
      PYTH_PRICE_FEEDS[normalized as keyof typeof PYTH_PRICE_FEEDS] || null
    );
  }

  /**
   * Check if price data is fresh (published within last N seconds)
   */
  static isPriceFresh(
    priceData: PythPriceData,
    maxAgeSeconds: number = 60
  ): boolean {
    const now = Math.floor(Date.now() / 1000);
    const age = now - priceData.publishTime;
    return age <= maxAgeSeconds;
  }

  /**
   * Calculate deviation from peg (for stablecoins)
   */
  static calculateDeviation(price: number, peg: number = 1.0): number {
    return Math.abs(price - peg) / peg;
  }
}

/**
 * Pyth contract addresses on different chains
 */
export const PYTH_CONTRACT_ADDRESSES: Record<number, string> = {
  1: "0x4305FB66699C3B2702D4d05CF36551390A4c69C6", // Ethereum Mainnet
  11155111: "0xDd24F84d36BF92C65F92307595335bdFab5Bbd21", // Sepolia
  42161: "0xff1a0f4744e8582DF1aE09D5611b887B6a12925C", // Arbitrum
  10: "0xff1a0f4744e8582DF1aE09D5611b887B6a12925C", // Optimism
  137: "0xff1a0f4744e8582DF1aE09D5611b887B6a12925C", // Polygon
  8453: "0x8250f4aF4B972684F7b336503E2D6dFeDeB1487a", // Base
};

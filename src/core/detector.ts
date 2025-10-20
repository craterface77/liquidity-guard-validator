import { formatUnits, type BlockTag } from "ethers";
import type { CurveIndexer } from "../lib/curve/indexer.js";

export interface DetectorOptions {
  minimumReserveRatio: number;
  gracePeriodSeconds: number;
  usdcDecimals: number;
  usdfDecimals: number;
}

export interface DetectorEvent {
  event: "DEPEG_START" | "DEPEG_END";
  start: number;
  end?: number;
  reserveRatio: number;
}

export class Detector {
  private readonly indexer: CurveIndexer;
  private readonly config: DetectorOptions;
  private windowStart: number | null = null;
  private lastBreachAt: number | null = null;
  private activeDepeg = false;

  constructor(indexer: CurveIndexer, options: DetectorOptions) {
    this.indexer = indexer;
    this.config = options;
  }

  private computeReserveRatio(usdc: number, usdf: number) {
    if (usdc + usdf === 0) return 0;
    return usdc / (usdc + usdf);
  }

  async sample(
    sampleTimestamp: number,
    blockTag: BlockTag
  ): Promise<DetectorEvent | null> {
    const balances = await this.indexer.balancesAt(blockTag);
    const usdc = Number(formatUnits(balances.b0, this.config.usdcDecimals));
    const usdf = Number(formatUnits(balances.b1, this.config.usdfDecimals));
    const reserveRatio = this.computeReserveRatio(usdc, usdf);

    if (reserveRatio < this.config.minimumReserveRatio) {
      if (!this.lastBreachAt) this.lastBreachAt = sampleTimestamp;
      if (
        sampleTimestamp - this.lastBreachAt >=
        this.config.gracePeriodSeconds
      ) {
        if (!this.activeDepeg) {
          this.activeDepeg = true;
          this.windowStart = this.lastBreachAt;
          return {
            event: "DEPEG_START",
            start: this.windowStart ?? sampleTimestamp,
            reserveRatio,
          };
        }
      }
    } else {
      if (this.activeDepeg) {
        const start = this.windowStart ?? sampleTimestamp;
        this.activeDepeg = false;
        this.lastBreachAt = null;
        this.windowStart = null;
        return {
          event: "DEPEG_END",
          start,
          end: sampleTimestamp,
          reserveRatio,
        };
      }
      this.lastBreachAt = null;
    }

    return null;
  }
}

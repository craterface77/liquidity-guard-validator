import { GRACE_SECONDS, R_MIN, Q_BASE } from '../config.js';
import type { CurveIndexer } from '../indexer/curve.js';

export class Detector {
  indexer: CurveIndexer;
  windowStart: number | null = null;
  lastBreachAt: number | null = null;
  activeDepeg: boolean = false;

  constructor(indexer: CurveIndexer) {
    this.indexer = indexer;
  }

  // compute R = USDC / (USDC + USDf)
  computeR(usdc: number, usdf: number) {
    if (usdc + usdf === 0) return 0;
    return usdc / (usdc + usdf);
  }

  // run once per sample (sampleTimestamp is unix seconds; blockTag can be block number)
  async sample(sampleTimestamp:number, blockTag: any) {
    const b = await this.indexer.balancesAt(blockTag);
    const usdc = Number(ethers.utils.formatUnits(b.b0, 6)); // if USDC is b0; if reversed swap
    const usdf = Number(ethers.utils.formatUnits(b.b1, 6));
    const R = this.computeR(usdc, usdf);
    if (R < R_MIN) {
      if (!this.lastBreachAt) this.lastBreachAt = sampleTimestamp;
      // check hold time
      if ((sampleTimestamp - this.lastBreachAt) >= GRACE_SECONDS) {
        // enter depeg S if not active
        if (!this.activeDepeg) {
          this.activeDepeg = true;
          this.windowStart = this.lastBreachAt;
          return { event: 'DEPEG_START', start: this.windowStart, R };
        }
      }
    } else {
      // if activeDepeg and recovered -> end
      if (this.activeDepeg) {
        const end = sampleTimestamp;
        this.activeDepeg = false;
        this.lastBreachAt = null;
        const start = this.windowStart || 0;
        this.windowStart = null;
        return { event: 'DEPEG_END', start, end, R };
      }
      this.lastBreachAt = null;
    }
    return null;
  }
}

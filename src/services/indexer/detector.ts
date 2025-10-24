export interface DetectorConfig {
  rMinBps: number;
  gracePeriodSeconds: number;
}

export interface DetectorEventStart {
  type: "DEPEG_START";
  start: number;
  rBps: number;
}

export interface DetectorEventEnd {
  type: "DEPEG_END";
  start: number;
  end: number;
  rBps: number;
}

export type DetectorEvent = DetectorEventStart | DetectorEventEnd | null;

export class Detector {
  private lastBreachAt: number | null = null;
  private windowStart: number | null = null;
  private active = false;

  constructor(private readonly config: DetectorConfig) {}

  sample(timestamp: number, rBps: number): DetectorEvent {
    if (rBps < this.config.rMinBps) {
      if (this.lastBreachAt === null) {
        this.lastBreachAt = timestamp;
      }
      if (
        !this.active &&
        timestamp - this.lastBreachAt >= this.config.gracePeriodSeconds
      ) {
        this.active = true;
        this.windowStart = this.lastBreachAt;
        return { type: "DEPEG_START", start: this.windowStart, rBps };
      }
      return null;
    }

    if (this.active) {
      const start = this.windowStart ?? timestamp;
      this.reset();
      return { type: "DEPEG_END", start, end: timestamp, rBps };
    }

    this.reset();
    return null;
  }

  private reset() {
    this.active = false;
    this.lastBreachAt = null;
    this.windowStart = null;
  }
}

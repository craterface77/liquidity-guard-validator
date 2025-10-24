import { Wallet } from "ethers";
import { randomUUID } from "crypto";
import { clickhouseInsert } from "../../db/clickhouse";
import { env } from "../../config/env";
import { logger } from "../../lib/logger";
import { toDateTimeString } from "../../lib/time";
import { createSnapshot } from "../../lib/ipfs";
import { CurveIndexer } from "./curveIndexer";
import { Detector } from "./detector";

export interface WebhookEmitter {
  (event: { kind: string; payload: unknown }): Promise<void>;
}

interface ActiveEvent {
  riskId: string;
  start: number;
  version: number;
  maxLossBps: number;
  minRBps: number;
}

export class IndexerService {
  private readonly indexer = new CurveIndexer();
  private readonly detector = new Detector({
    rMinBps: env.R_MIN_BPS,
    gracePeriodSeconds: env.GRACE_PERIOD_SECONDS,
  });
  private currentEvent: ActiveEvent | null = null;

  constructor(private readonly emitWebhook: WebhookEmitter = async () => {}) {}

  async poll() {
    const sample = await this.indexer.fetchSample();

    await clickhouseInsert({
      table: "liquidityguard.pool_samples",
      values: [
        {
          pool_id: env.POOL_ID,
          chain_id: env.CHAIN_ID,
          ts: toDateTimeString(sample.ts),
          block_number: sample.blockNumber,
          reserve_base: sample.reserveBase,
          reserve_quote: sample.reserveQuote,
          total_lp_supply: sample.totalSupply,
          price: sample.price,
          r_bps: sample.rBps,
          loss_quote_bps: sample.lossQuoteBps,
          twap_bps: sample.twapBps,
          sample_source: env.SAMPLE_SOURCE,
          tags: ["live"],
        },
      ],
    });

    if (this.currentEvent) {
      this.currentEvent.maxLossBps = Math.max(
        this.currentEvent.maxLossBps,
        sample.lossQuoteBps
      );
      this.currentEvent.minRBps = Math.min(
        this.currentEvent.minRBps,
        sample.rBps
      );
      await this.persistEvent({
        riskId: this.currentEvent.riskId,
        windowStart: this.currentEvent.start,
        windowEnd: null,
        state: "OPEN",
        severityBps: this.currentEvent.maxLossBps,
        rBps: sample.rBps,
        twapBps: sample.twapBps,
      });
    }

    const event = this.detector.sample(
      Math.floor(sample.ts.getTime() / 1000),
      sample.rBps
    );
    if (!event) {
      return;
    }

    if (event.type === "DEPEG_START") {
      const riskId = `${env.POOL_ID}|${event.start}`;

      // Create snapshot at depeg start
      const snapshotCid = await createSnapshot({
        timestamp: event.start,
        blockNumber: sample.blockNumber,
        poolId: env.POOL_ID,
        chainId: env.CHAIN_ID,
        reserves: {
          base: sample.reserveBase,
          quote: sample.reserveQuote,
          totalSupply: sample.totalSupply,
        },
        price: sample.price,
        rBps: sample.rBps,
        lossQuoteBps: sample.lossQuoteBps,
        twapBps: sample.twapBps,
      });

      // Store snapshot reference
      await this.persistSnapshot({
        snapshotId: randomUUID(),
        riskId,
        cid: snapshotCid,
        label: "DEPEG_START",
        note: `Depeg window opened at block ${sample.blockNumber}`,
      });

      this.currentEvent = {
        riskId,
        start: event.start,
        version: 1,
        maxLossBps: sample.lossQuoteBps,
        minRBps: sample.rBps,
      };

      await this.persistEvent({
        riskId,
        windowStart: event.start,
        windowEnd: null,
        state: "OPEN",
        severityBps: sample.lossQuoteBps,
        rBps: sample.rBps,
        twapBps: sample.twapBps,
      });

      await this.emitWebhook({
        kind: "DEPEG_START",
        payload: {
          type: "DEPEG_START",
          riskId,
          timestamp: event.start,
          twapE18: sample.twapBps * 10_000,
          snapshotCid,
          signature: null,
        },
      });

      logger.info(
        { riskId, snapshotCid, rBps: sample.rBps },
        "depeg_window_opened"
      );
      return;
    }

    if (event.type === "DEPEG_END" && this.currentEvent) {
      const severity = Math.max(
        this.currentEvent.maxLossBps,
        sample.lossQuoteBps
      );

      // Create snapshot at depeg end
      const snapshotCid = await createSnapshot({
        timestamp: event.end,
        blockNumber: sample.blockNumber,
        poolId: env.POOL_ID,
        chainId: env.CHAIN_ID,
        reserves: {
          base: sample.reserveBase,
          quote: sample.reserveQuote,
          totalSupply: sample.totalSupply,
        },
        price: sample.price,
        rBps: sample.rBps,
        lossQuoteBps: sample.lossQuoteBps,
        twapBps: sample.twapBps,
      });

      // Store snapshot reference
      await this.persistSnapshot({
        snapshotId: randomUUID(),
        riskId: this.currentEvent.riskId,
        cid: snapshotCid,
        label: "DEPEG_END",
        note: `Depeg window closed at block ${sample.blockNumber}`,
      });

      await this.persistEvent({
        riskId: this.currentEvent.riskId,
        windowStart: this.currentEvent.start,
        windowEnd: event.end,
        state: "RESOLVED",
        severityBps: severity,
        rBps: sample.rBps,
        twapBps: sample.twapBps,
      });

      await this.emitWebhook({
        kind: "DEPEG_END",
        payload: {
          type: "DEPEG_END",
          riskId: this.currentEvent.riskId,
          timestamp: event.end,
          twapE18: sample.twapBps * 10_000,
          snapshotCid,
          signature: null,
        },
      });

      logger.info(
        {
          riskId: this.currentEvent.riskId,
          snapshotCid,
          duration: event.end - this.currentEvent.start,
        },
        "depeg_window_closed"
      );

      this.currentEvent = null;
    }
  }

  private async persistEvent(params: {
    riskId: string;
    windowStart: number;
    windowEnd: number | null;
    state: string;
    severityBps: number;
    rBps: number;
    twapBps: number;
  }) {
    const now = new Date();
    await clickhouseInsert({
      table: "liquidityguard.risk_events",
      values: [
        {
          risk_id: params.riskId,
          pool_id: env.POOL_ID,
          chain_id: env.CHAIN_ID,
          risk_type: "DEPEG_LP",
          risk_state: params.state,
          window_start: toDateTimeString(params.windowStart * 1000),
          window_end: params.windowEnd
            ? toDateTimeString(params.windowEnd * 1000)
            : null,
          severity_bps: params.severityBps,
          twap_bps: params.twapBps,
          r_bps: params.rBps,
          attested_at: toDateTimeString(now),
          attestor: env.SIGNER_PRIVATE_KEY
            ? deriveAddress(env.SIGNER_PRIVATE_KEY)
            : "0x0000000000000000000000000000000000000000",
          snapshot_cid: "",
          meta: JSON.stringify({ source: "indexer" }),
          version: this.nextVersion(params.riskId),
          created_at: toDateTimeString(now),
          updated_at: toDateTimeString(now),
        },
      ],
    });
  }

  private nextVersion(riskId: string) {
    if (this.currentEvent && this.currentEvent.riskId === riskId) {
      const current = this.currentEvent.version;
      this.currentEvent.version += 1;
      return current;
    }
    return 1;
  }

  private async persistSnapshot(params: {
    snapshotId: string;
    riskId: string;
    cid: string;
    label: string;
    note: string;
  }) {
    await clickhouseInsert({
      table: "liquidityguard.snapshots",
      values: [
        {
          snapshot_id: params.snapshotId,
          risk_id: params.riskId,
          pool_id: env.POOL_ID,
          cid: params.cid,
          label: params.label,
          note: params.note,
          uploaded_at: toDateTimeString(new Date()),
          meta: JSON.stringify({ source: "indexer" }),
        },
      ],
    });
  }
}

function deriveAddress(privateKey: string) {
  try {
    return new Wallet(privateKey).address;
  } catch (error) {
    logger.warn({ err: error }, "unable_to_derive_attestor_address");
    return "0x0000000000000000000000000000000000000000";
  }
}

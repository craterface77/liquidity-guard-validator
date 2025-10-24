import { createHash } from "crypto";
import { writeFile, readFile, mkdir } from "fs/promises";
import { join } from "path";
import { env } from "../config/env";
import { logger } from "./logger";

export interface PoolSnapshot {
  timestamp: number;
  blockNumber: number;
  poolId: string;
  chainId: number;
  reserves: {
    base: number;
    quote: number;
    totalSupply: number;
  };
  price: number;
  rBps: number;
  lossQuoteBps: number;
  twapBps: number;
}

/**
 * Generate a content-addressable CID (mock implementation)
 * In production, this would upload to IPFS and return real CID
 */
export async function createSnapshot(data: PoolSnapshot): Promise<string> {
  try {
    // Create deterministic hash as mock CID
    const content = JSON.stringify(data, null, 2);
    const hash = createHash("sha256").update(content).digest("hex");
    const cid = `bafy${hash.slice(0, 56)}`; // Mock CID format

    // Store locally for reference
    const dataDir = join(process.cwd(), env.DATA_DIR, "snapshots");
    await mkdir(dataDir, { recursive: true });

    const filePath = join(dataDir, `${cid}.json`);
    await writeFile(filePath, content, "utf8");

    logger.debug({ cid, blockNumber: data.blockNumber }, "snapshot_created");

    return cid;
  } catch (error) {
    logger.error({ err: error }, "snapshot_creation_failed");
    return "";
  }
}

/**
 * Retrieve snapshot by CID (from local storage)
 */
export async function getSnapshot(cid: string): Promise<PoolSnapshot | null> {
  try {
    const dataDir = join(process.cwd(), env.DATA_DIR, "snapshots");
    const filePath = join(dataDir, `${cid}.json`);

    const content = await readFile(filePath, "utf8");
    return JSON.parse(content) as PoolSnapshot;
  } catch (error) {
    logger.warn({ cid, err: error }, "snapshot_retrieval_failed");
    return null;
  }
}

/**
 * Upload to IPFS using web3.storage (if token configured)
 * Falls back to local storage if not configured
 */
export async function uploadToIPFS(data: PoolSnapshot): Promise<string> {
  // If IPFS token is configured, use real IPFS
  if (env.IPFS_API_TOKEN) {
    try {
      // For now, fallback to local - can add real IPFS integration later
      logger.info("IPFS_API_TOKEN configured but using local storage for now");
    } catch (error) {
      logger.warn({ err: error }, "ipfs_upload_failed_fallback_to_local");
    }
  }

  return createSnapshot(data);
}

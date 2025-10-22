#!/usr/bin/env node
import { JsonRpcProvider, Contract, formatUnits } from 'ethers';
import { randomUUID } from 'crypto';
import { clickhouseInsert } from '../src/db/clickhouse';
import { env } from '../src/config/env';
import { logger } from '../src/lib/logger';
import { toDateTimeString } from '../src/lib/time';
import { createSnapshot } from '../src/lib/ipfs';
import { Detector } from '../src/services/indexer/detector';

const POOL_ABI = [
  'function balances(uint256) view returns (uint256)',
  'function coins(uint256) view returns (address)',
  'function totalSupply() view returns (uint256)',
];

const ERC20_ABI = ['function decimals() view returns (uint8)'];

const GET_DY_SIGNATURES = [
  'function get_dy(int128,int128,uint256) view returns (uint256)',
  'function get_dy(int256,int256,uint256) view returns (uint256)',
  'function get_dy_underlying(int128,int128,uint256) view returns (uint256)',
];

interface SimulationConfig {
  fromBlock: number;
  toBlock: number;
  step?: number;
}

async function getTokenDecimals(provider: JsonRpcProvider, address: string): Promise<number> {
  const token = new Contract(address, ERC20_ABI, provider);
  try {
    const decimalsFn = token.getFunction('decimals');
    const decimals = await decimalsFn();
    return Number(decimals);
  } catch {
    return env.BASE_TOKEN_DECIMALS;
  }
}

async function getExchangeRate(
  provider: JsonRpcProvider,
  poolAddress: string,
  dec0: number,
  dec1: number,
  blockNumber: number,
): Promise<number> {
  const { parseUnits, formatUnits, Interface } = await import('ethers');
  const oneUnit = parseUnits('1', dec0);

  for (const signature of GET_DY_SIGNATURES) {
    const iface = new Interface([signature]);
    const fragment = iface.fragments[0];
    if (!fragment) continue;

    try {
      const data = iface.encodeFunctionData(fragment as any, [0, 1, oneUnit]);
      const raw = await provider.call({ to: poolAddress, data, blockTag: blockNumber });
      const [amountOut] = iface.decodeFunctionResult(fragment as any, raw);
      return Number(formatUnits(amountOut, dec1));
    } catch {
      continue;
    }
  }
  return 1.0; // fallback
}

async function fetchSampleAtBlock(provider: JsonRpcProvider, pool: Contract, blockNumber: number) {
  const block = await provider.getBlock(blockNumber);
  if (!block) {
    throw new Error(`block_not_found: ${blockNumber}`);
  }

  const coinsFn = pool.getFunction('coins');
  const balancesFn = pool.getFunction('balances');
  const totalSupplyFn = pool.getFunction('totalSupply');

  const [coin0, coin1] = await Promise.all([
    coinsFn(0, { blockTag: blockNumber }),
    coinsFn(1, { blockTag: blockNumber }),
  ]);

  const [dec0, dec1] = await Promise.all([
    getTokenDecimals(provider, coin0),
    getTokenDecimals(provider, coin1),
  ]);

  const [raw0, raw1, totalSupplyRaw] = await Promise.all([
    balancesFn(0, { blockTag: blockNumber }),
    balancesFn(1, { blockTag: blockNumber }),
    totalSupplyFn({ blockTag: blockNumber }),
  ]);

  const reserve0 = Number(formatUnits(raw0, dec0));
  const reserve1 = Number(formatUnits(raw1, dec1));
  const totalSupply = Number(formatUnits(totalSupplyRaw, dec0));

  // Calculate price using get_dy for accurate pricing
  const price = await getExchangeRate(provider, env.POOL_ADDRESS, dec0, dec1, blockNumber);
  const rRatio = reserve0 + reserve1 === 0 ? 0 : reserve0 / (reserve0 + reserve1);
  const rBps = Math.round(rRatio * 10_000);

  // Simple loss estimation: deviation from 1.0
  const lossQuoteBps = Math.max(0, Math.round(Math.abs(1 - price) * 10_000));

  return {
    ts: new Date(block.timestamp * 1000),
    blockNumber,
    reserveBase: reserve0,
    reserveQuote: reserve1,
    totalSupply,
    price,
    rBps,
    lossQuoteBps,
    twapBps: 10_000, // Simplified for simulation
  };
}

async function simulate(config: SimulationConfig) {
  const provider = new JsonRpcProvider(env.RPC_URL);
  const pool = new Contract(env.POOL_ADDRESS, POOL_ABI, provider);
  const detector = new Detector({
    rMinBps: env.R_MIN_BPS,
    gracePeriodSeconds: env.GRACE_PERIOD_SECONDS,
  });

  const step = config.step || 100; // Default: every 100 blocks (~20 min)
  const totalBlocks = config.toBlock - config.fromBlock;
  let processed = 0;

  logger.info(
    {
      fromBlock: config.fromBlock,
      toBlock: config.toBlock,
      totalBlocks,
      step,
    },
    'simulation_started',
  );

  const risks: Map<string, { riskId: string; start: number; maxLoss: number; minR: number }> = new Map();

  for (let block = config.fromBlock; block <= config.toBlock; block += step) {
    try {
      const sample = await fetchSampleAtBlock(provider, pool, block);
      processed++;

      // Store sample to DB
      await clickhouseInsert({
        table: 'liquidityguard.pool_samples',
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
            sample_source: 'simulator',
            tags: ['simulation'],
          },
        ],
      });

      const timestamp = Math.floor(sample.ts.getTime() / 1000);
      const event = detector.sample(timestamp, sample.rBps);

      if (event?.type === 'DEPEG_START') {
        const riskId = `${env.POOL_ID}|${event.start}`;

        // Create snapshot
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

        risks.set(riskId, {
          riskId,
          start: event.start,
          maxLoss: sample.lossQuoteBps,
          minR: sample.rBps,
        });

        // Store snapshot
        await clickhouseInsert({
          table: 'liquidityguard.snapshots',
          values: [
            {
              snapshot_id: randomUUID(),
              risk_id: riskId,
              pool_id: env.POOL_ID,
              cid: snapshotCid,
              label: 'DEPEG_START',
              note: `Simulation: Depeg at block ${sample.blockNumber}`,
              uploaded_at: toDateTimeString(sample.ts),
              meta: JSON.stringify({ simulation: true }),
            },
          ],
        });

        // Store risk event
        await clickhouseInsert({
          table: 'liquidityguard.risk_events',
          values: [
            {
              risk_id: riskId,
              pool_id: env.POOL_ID,
              chain_id: env.CHAIN_ID,
              risk_type: 'DEPEG_LP',
              risk_state: 'OPEN',
              window_start: toDateTimeString(event.start * 1000),
              window_end: null,
              severity_bps: sample.lossQuoteBps,
              twap_bps: sample.twapBps,
              r_bps: sample.rBps,
              attested_at: toDateTimeString(sample.ts),
              attestor: '0x0000000000000000000000000000000000000000',
              snapshot_cid: snapshotCid,
              meta: JSON.stringify({ simulation: true }),
              version: 1,
              created_at: toDateTimeString(sample.ts),
              updated_at: toDateTimeString(sample.ts),
            },
          ],
        });

        logger.info({ riskId, block, rBps: sample.rBps, snapshotCid }, 'depeg_detected');
      }

      if (event?.type === 'DEPEG_END') {
        const riskId = `${env.POOL_ID}|${event.start}`;
        const riskData = risks.get(riskId);

        if (riskData) {
          // Create end snapshot
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

          await clickhouseInsert({
            table: 'liquidityguard.snapshots',
            values: [
              {
                snapshot_id: randomUUID(),
                risk_id: riskId,
                pool_id: env.POOL_ID,
                cid: snapshotCid,
                label: 'DEPEG_END',
                note: `Simulation: Recovery at block ${sample.blockNumber}`,
                uploaded_at: toDateTimeString(sample.ts),
                meta: JSON.stringify({ simulation: true }),
              },
            ],
          });

          // Update risk event
          await clickhouseInsert({
            table: 'liquidityguard.risk_events',
            values: [
              {
                risk_id: riskId,
                pool_id: env.POOL_ID,
                chain_id: env.CHAIN_ID,
                risk_type: 'DEPEG_LP',
                risk_state: 'RESOLVED',
                window_start: toDateTimeString(riskData.start * 1000),
                window_end: toDateTimeString(event.end * 1000),
                severity_bps: Math.max(riskData.maxLoss, sample.lossQuoteBps),
                twap_bps: sample.twapBps,
                r_bps: sample.rBps,
                attested_at: toDateTimeString(sample.ts),
                attestor: '0x0000000000000000000000000000000000000000',
                snapshot_cid: snapshotCid,
                meta: JSON.stringify({ simulation: true }),
                version: 2,
                created_at: toDateTimeString(sample.ts),
                updated_at: toDateTimeString(sample.ts),
              },
            ],
          });

          logger.info(
            { riskId, block, duration: event.end - riskData.start, snapshotCid },
            'depeg_resolved',
          );
          risks.delete(riskId);
        }
      }

      if (processed % 10 === 0) {
        const progress = ((block - config.fromBlock) / totalBlocks) * 100;
        logger.info({ block, progress: progress.toFixed(2) + '%', activeRisks: risks.size }, 'simulation_progress');
      }
    } catch (error) {
      logger.error({ block, err: error }, 'simulation_block_failed');
    }
  }

  logger.info({ processed, totalBlocks, detectedRisks: risks.size }, 'simulation_completed');
}

// Parse CLI arguments
const args = process.argv.slice(2);
const fromBlock = parseInt(args.find((arg) => arg.startsWith('--from='))?.split('=')[1] || '0');
const toBlock = parseInt(args.find((arg) => arg.startsWith('--to='))?.split('=')[1] || '0');
const step = parseInt(args.find((arg) => arg.startsWith('--step='))?.split('=')[1] || '100');

if (!fromBlock || !toBlock) {
  console.error('Usage: npm run simulate -- --from=BLOCK --to=BLOCK [--step=100]');
  console.error('Example: npm run simulate -- --from=18500000 --to=18510000 --step=50');
  process.exit(1);
}

simulate({ fromBlock, toBlock, step })
  .then(() => process.exit(0))
  .catch((error) => {
    logger.error({ err: error }, 'simulation_fatal_error');
    process.exit(1);
  });

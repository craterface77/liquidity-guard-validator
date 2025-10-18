import { CurveIndexer } from '../indexer/curve.js';
import { Detector } from '../detector/stateMachine.js';
import { POOL, Q_BASE } from '../config.js';
import { ethers } from 'ethers';
import dotenv from 'dotenv';
dotenv.config();

async function run() {
  const RPC = process.env.RPC_URL; // must be an archive node (Alchemy/Infura/Chainstack)
  const FORK_BLOCK = process.env.FORK_BLOCK ? Number(process.env.FORK_BLOCK) : undefined;
  if (!RPC) throw new Error('RPC_URL required in .env');

  const indexer = new CurveIndexer(RPC);
  const detector = new Detector(indexer);

  // sample loop: sample 10s intervals for N samples
  const samples = 60; // 10 minutes @ 10s => adjust
  const spacing = 10; // seconds

  const nowBlock = FORK_BLOCK ?? await indexer.provider.getBlockNumber();
  console.log('Using block', nowBlock);

  // find coin mapping
  const poolContract = new ethers.Contract(POOL.address, ['function coins(uint256) view returns (address)'], indexer.provider);
  const coin0 = await poolContract.coins(0);
  const coin1 = await poolContract.coins(1);
  console.log('coins:', coin0, coin1);

  // sample: for mainnet forks use consecutive block numbers; if not, you can compute based on timestamp
  for (let i=0; i<samples; i++) {
    const blockTag = nowBlock + i; // if forking, block increment works with anvil
    const block = await indexer.provider.getBlock(blockTag);
    const sampleTs = block.timestamp;
    const out = await detector.sample(sampleTs, blockTag);
    if (out) {
      console.log('DETECTOR EVENT:', out);
      // When DEPEG_START or END happens, compute loss_quote using get_dy for Q_BASE
      // Map coin indexes: find which index corresponds to USDf vs USDC
      // Example: assume coin0 = USDC. For realistic code determine which is USDC by address compare.
      // Compute get_dy for Q_BASE (in decimals)
      // Build EIP-712 payload and print (signing in real run)
      break;
    }
    await new Promise(r=>setTimeout(r, 50)); // tiny throttle
  }
}

run().catch(e => { console.error(e); process.exit(1); });

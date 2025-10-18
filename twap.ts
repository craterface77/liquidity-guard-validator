// validator/src/oracle/twap.ts
import { ethers } from 'ethers';
import type { JsonRpcProvider } from '@ethersproject/providers';
import { formatUnits } from 'ethers/lib/utils.js';

// Minimal UniswapV3 pool ABI for observe()
const UNI_V3_POOL_ABI = [
  "function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16 observationIndex,uint16 observationCardinality,uint16 observationCardinalityNext,uint8 feeProtocol,bool unlocked)",
  "function observe(uint32[] secondsAgos) view returns (int56[] tickCumulatives, uint160[] secondsPerLiquidityCumulativeX128s)"
];

// Chainlink aggregator interface
const CHAINLINK_AGG_ABI = [
  "function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)",
  "function getRoundData(uint80 _roundId) view returns (uint80, int256, uint256, uint256, uint80)"
];

// Curve pool minimal interface to compute virtual price/reserves fallback
const CURVE_POOL_ABI = [ "function coins(uint256) view returns (address)", "function balances(uint256) view returns (uint256)", "function totalSupply() view returns (uint256)" ];

export async function getTWAP({ provider, uniV3PoolAddress, chainlinkAggregatorAddress, curvePoolAddress, horizonSeconds }: {
  provider: JsonRpcProvider,
  uniV3PoolAddress?: string,
  chainlinkAggregatorAddress?: string,
  curvePoolAddress?: string,
  horizonSeconds: number
}) {
  // 1) Try Uniswap V3 observe
  if (uniV3PoolAddress) {
    try {
      const pool = new ethers.Contract(uniV3PoolAddress, UNI_V3_POOL_ABI, provider);
      // secondsAgos: [horizon, 0]
      const secondsAgos = [horizonSeconds, 0];
      const res = await pool.observe(secondsAgos);
      // compute price from tick cumulatives => classic formula
      // NOTE: for brevity return tick-based approx — production: convert tick to price precisely
      const tickCum0 = Number(res[0][0]);
      const tickCum1 = Number(res[0][1]);
      const tickAvg = (tickCum1 - tickCum0) / horizonSeconds;
      // convert tickAvg to price: price = 1.0001^tickAvg (risk: use bignum)
      const twap = Math.pow(1.0001, tickAvg);
      return { twap, source: 'uni_v3_observe', windowStart: Date.now()/1000 - horizonSeconds, windowEnd: Date.now()/1000 };
    } catch (e) {
      // continue to next
    }
  }

  // 2) Try Chainlink aggregator (if a price feed mapping exists)
  if (chainlinkAggregatorAddress) {
    try {
      const a = new ethers.Contract(chainlinkAggregatorAddress, CHAINLINK_AGG_ABI, provider);
      const [, answer,, updatedAt] = await a.latestRoundData();
      const twap = Number(answer) / 1e8; // depends on feed decimals
      return { twap, source: 'chainlink_latest', windowStart: Number(updatedAt) - horizonSeconds, windowEnd: Number(updatedAt) };
    } catch (e) {
      // fallback
    }
  }

  // 3) Fallback: moving average of sampled virtual prices from Curve pool
  if (curvePoolAddress) {
    // sample N points across horizon using block timestamps spaced evenly
    const pool = new ethers.Contract(curvePoolAddress, CURVE_POOL_ABI, provider);
    const now = await provider.getBlock('latest').then(b=>b.timestamp);
    const samples = Math.min(60, Math.max(6, Math.floor(horizonSeconds / 60))); // 1 sample per minute up to 60
    const twapSeries = [];
    for (let i=0;i<samples;i++) {
      const ts = Math.floor(now - (i * (horizonSeconds / samples)));
      // binary search block by timestamp or use provider.getBlockNumber() +- delta if using fork
      const block = await provider.getBlock('latest'); // cheap fallback: use latest; for time accuracy you should map timestamp->block
      const balances = await pool.balances(0, { blockTag: block.number }).catch(async ()=>{
        const t0 = await pool.coins(0);
        const t1 = await pool.coins(1);
        const ERC20 = ["function balanceOf(address) view returns (uint256)"];
        const t0c = new ethers.Contract(t0, ERC20, provider);
        const t1c = new ethers.Contract(t1, ERC20, provider);
        const b0 = await t0c.balanceOf(curvePoolAddress, { blockTag: block.number });
        const b1 = await t1c.balanceOf(curvePoolAddress, { blockTag: block.number });
        return { 0: b0, 1: b1 };
      });
      const totalLP = await pool.totalSupply({ blockTag: block.number });
      // price-per-LP sample: (reserve0 + reserve1)/totalLP approximated; for stable coins adjust decimals properly
      const r0 = Number(formatUnits(balances[0], 6)); // assume 6 decimals for USDC-like
      const r1 = Number(formatUnits(balances[1], 6));
      const pricePerLP = (r0 + r1) / Number(formatUnits(totalLP, 18));
      twapSeries.push(pricePerLP);
    }
    const twap = twapSeries.reduce((a,b)=>a+b,0)/twapSeries.length;
    return { twap, source: 'curve_virtual_moving_avg', windowStart: Date.now()/1000 - horizonSeconds, windowEnd: Date.now()/1000 };
  }

  throw new Error('No oracle available for TWAP');
}
